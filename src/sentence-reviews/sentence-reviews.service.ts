import { QuotaService, submissionHash } from '../billing/quota.service';
import { billingError } from '../billing/billing.policy';
import {
  BadRequestException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { readTrainingContext } from '../scenes/training-context';
import {
  lockStudyUser,
  lockStudySession,
} from '../study-sessions/study-session-ledger';
import { PrismaService } from '../database/prisma.service';
import { publicAiReviewErrorMessage } from '../ai/public-error';
import { recallPolicyForEvidence } from '../review/adaptive-review';
import { CreateSentenceReviewDto } from './dto/create-review.dto';

@Injectable()
export class SentenceReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly quota?: QuotaService,
  ) {}

  async create(userId: string, dto: CreateSentenceReviewDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockStudyUser(tx, userId);
      await lockStudySession(tx, dto.sessionId);
      const session = await tx.studySession.findUnique({
        where: { id: dto.sessionId },
      });
      if (!session || session.userId !== userId)
        throw new NotFoundException({
          code: 'SESSION_NOT_FOUND',
          message: 'Study session not found',
        });
      if (session.status !== 'ACTIVE')
        throw new BadRequestException({
          code: 'SESSION_ALREADY_COMPLETED',
          message: 'Study session is not active',
        });
      const payloadHash = submissionHash([
        dto.sessionId,
        dto.sentence,
        dto.scene ?? null,
      ]);
      if (this.quota) {
        const auth = await tx.taskAuthorization.findUnique({
          where: { kind_taskKey: { kind: 'GRAMMAR', taskKey: session.id } },
        });
        const previous = auth
          ? await tx.taskSubmission.findUnique({
              where: {
                authorizationId_requestKey: {
                  authorizationId: auth.id,
                  requestKey: dto.requestKey ?? payloadHash,
                },
              },
            })
          : null;
        if (previous) {
          if (
            previous.userId !== userId ||
            previous.payloadHash !== payloadHash
          )
            billingError('IDEMPOTENCY_CONFLICT');
          if (previous.resultId) {
            const original = await tx.aiReviewJob.findUniqueOrThrow({
              where: { id: previous.resultId },
            });
            return { reviewId: original.id, status: original.status };
          }
        }
      }
      const submission = await this.quota?.authorizeSubmission(
        tx,
        userId,
        'GRAMMAR',
        session.id,
        dto.requestKey ?? payloadHash,
        payloadHash,
      );
      if (submission?.resultId) {
        const original = await tx.aiReviewJob.findUniqueOrThrow({
          where: { id: submission.resultId },
        });
        return { reviewId: original.id, status: original.status };
      }
      const attempt = await tx.sentenceAttempt.create({
        data: {
          userId,
          grammarId: session.grammarId,
          studySessionId: session.id,
          source:
            session.mode === 'LEARN'
              ? 'NEW_LEARNING'
              : session.mode === 'REVIEW'
                ? 'REVIEW'
                : 'FREE_PRACTICE',
          sentence: dto.sentence,
          scene:
            readTrainingContext(session.trainingContext)?.scenario?.promptZh ??
            dto.scene,
          aiJob: { create: {} },
        },
        include: { aiJob: true },
      });
      if (submission)
        await tx.taskSubmission.update({
          where: { id: submission.id },
          data: { resultId: attempt.aiJob!.id },
        });
      return { reviewId: attempt.aiJob!.id, status: attempt.aiJob!.status };
    });
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.aiReviewJob.findUnique({
      where: { id },
      include: { result: true, attempt: true },
    });
    if (!job || job.attempt.userId !== userId)
      throw new NotFoundException({
        code: 'REVIEW_NOT_FOUND',
        message: 'Sentence review not found',
      });
    return {
      ...job,
      errorMessage:
        job.status === 'FAILED'
          ? publicAiReviewErrorMessage(job.errorCode)
          : null,
      result: job.result
        ? {
            ...job.result,
            recallPolicy: recallPolicyForEvidence({
              totalScore: job.result.totalScore,
              usedTargetGrammar: job.result.usedTargetGrammar,
              targetGrammarCorrect: job.result.targetGrammarCorrect,
            }),
          }
        : null,
    };
  }

  async retry(userId: string, id: string) {
    const job = await this.get(userId, id);
    if (job.status !== 'FAILED')
      throw new BadRequestException({
        code: 'REVIEW_NOT_FAILED',
        message: 'Only failed reviews can be retried',
      });
    if (job.retryCount >= 4)
      throw new BadRequestException({
        code: 'RETRY_LIMIT_REACHED',
        message: 'Review retry limit reached',
      });
    return this.prisma.$transaction(async (tx) => {
      await lockStudyUser(tx, userId);
      const fresh = await tx.aiReviewJob.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'FAILED') billingError('REQUEST_IN_PROGRESS');
      const submission = await tx.taskSubmission.findFirst({
        where: { resultId: id, userId },
      });
      if (submission && this.quota)
        await this.quota.authorizeSubmission(
          tx,
          userId,
          'GRAMMAR',
          job.attempt.studySessionId,
          submission.requestKey,
          submission.payloadHash ?? undefined,
        );
      return tx.aiReviewJob.update({
        where: { id },
        data: {
          status: 'QUEUED',
          availableAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
    });
  }
}
