import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { publicAiReviewErrorMessage } from '../ai/public-error';
import { recallPolicyForEvidence } from '../review/adaptive-review';
import { CreateSentenceReviewDto } from './dto/create-review.dto';

@Injectable()
export class SentenceReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSentenceReviewDto) {
    const session = await this.prisma.studySession.findUnique({
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
    const attempt = await this.prisma.sentenceAttempt.create({
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
        scene: dto.scene,
        aiJob: { create: {} },
      },
      include: { aiJob: true },
    });
    return { reviewId: attempt.aiJob!.id, status: attempt.aiJob!.status };
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
    return this.prisma.aiReviewJob.update({
      where: { id },
      data: {
        status: 'QUEUED',
        availableAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
    });
  }
}
