import { QuotaService, submissionHash } from '../billing/quota.service';
import { billingError } from '../billing/billing.policy';
import { lockBillingUser } from '../billing/entitlement.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Optional,
  NotFoundException,
} from '@nestjs/common';
import { localDayBounds } from './vocabulary-learning.service';
import { isUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { lockLearning, requireVocabulary } from './vocabulary-learning.db';
import {
  dueLearning,
  isEnabled,
  MAX_ATTEMPTS,
  OPEN_STATUSES,
  visibleVocabulary,
} from './vocabulary-learning.policy';
import {
  practiceInclude,
  presentPractice,
} from './vocabulary-practice.presenter';
import type {
  StartVocabularyPracticeDto,
  VocabularyAnswerDto,
} from './vocabulary-learning.dto';

@Injectable()
export class VocabularyPracticeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly quota?: QuotaService,
  ) {}

  async start(userId: string, input: StartVocabularyPracticeDto) {
    let vocabularyId = input.vocabularyId;
    let automaticDay: { gte: Date; lt: Date } | undefined;
    if (!vocabularyId) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      const now = new Date();
      automaticDay = localDayBounds(user.timezone, now);
      const due = await this.prisma.vocabularyLearning.findFirst({
        where: {
          userId,
          ...dueLearning(now, automaticDay),
          vocabulary: visibleVocabulary(userId),
        },
        orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
      });
      if (!due) throw new NotFoundException('No vocabulary due');
      vocabularyId = due.vocabularyId;
    }
    const id = vocabularyId;
    return this.prisma.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      await requireVocabulary(tx, userId, id);
      const learning = await lockLearning(tx, userId, id);
      if (!isEnabled(learning))
        throw new ConflictException('Vocabulary learning is not enabled');
      let grammarId = input.grammarId;
      if (input.studySessionId) {
        const session = await tx.studySession.findFirst({
          where: {
            id: input.studySessionId,
            userId,
            status: 'ACTIVE',
            grammar: { status: 'PUBLISHED' },
          },
        });
        if (!session)
          throw new NotFoundException('Active study session not found');
        if (grammarId && grammarId !== session.grammarId)
          throw new BadRequestException('Grammar does not match study session');
        grammarId = session.grammarId;
      }
      if (
        grammarId &&
        !(await tx.grammarPoint.findFirst({
          where: { id: grammarId, status: 'PUBLISHED' },
        }))
      )
        throw new NotFoundException('Published grammar not found');
      const existing = await tx.vocabularyPractice.findFirst({
        where: { learningId: learning.id, status: { in: OPEN_STATUSES } },
        include: practiceInclude,
      });
      if (existing) {
        await this.quota?.authorizeTask(tx, userId, 'VOCABULARY', existing.id);
        return presentPractice(existing);
      }
      const now = new Date();
      if (
        automaticDay &&
        !(await tx.vocabularyLearning.findFirst({
          where: { id: learning.id, ...dueLearning(now, automaticDay) },
        }))
      )
        throw new ConflictException('复习清单已更新，请重新选择下一个词。');
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { explanationLocale: true },
      });
      const practice = await tx.vocabularyPractice.create({
        data: {
          userId,
          explanationLocale: user.explanationLocale || 'zh',
          vocabularyId: id,
          learningId: learning.id,
          grammarId,
          linkedStudySessionId: input.studySessionId,
          learningRevision: learning.manualRevision,
          unknownAtStart: learning.knowledge === 'UNKNOWN',
          dueAtStart: !!learning.nextReviewAt && learning.nextReviewAt <= now,
        },
        include: practiceInclude,
      });
      await this.quota?.authorizeTask(tx, userId, 'VOCABULARY', practice.id);
      return presentPractice(practice);
    });
  }

  private async owned(userId: string, id: string) {
    const row = await this.prisma.vocabularyPractice.findFirst({
      where: { id, userId, vocabulary: visibleVocabulary(userId) },
      include: practiceInclude,
    });
    if (!row) throw new NotFoundException('Vocabulary practice not found');
    return row;
  }

  async get(userId: string, id: string) {
    const row = await this.owned(userId, id);
    const attempts = await this.prisma.vocabularyPracticeAttempt.findMany({
      where: { practiceId: id, userId },
      orderBy: { ordinal: 'asc' },
    });
    const latest = attempts.at(-1);
    return {
      ...presentPractice(
        latest
          ? {
              ...row,
              answer: latest.answer,
              assessment: latest.assessment,
              status: latest.status === 'QUEUED' ? 'ASSESSING' : latest.status,
              errorCode: latest.errorCode,
              completedAt: latest.completedAt,
            }
          : row,
      ),
      explanationLocale: row.explanationLocale,
      firstAssessment: row.assessment,
      reviewAttempts: attempts.map((a) => ({
        id: a.id,
        ordinal: a.ordinal,
        requestKey: a.requestKey,
        status: a.status,
        answer: a.answer,
        result: a.assessment,
        errorCode: a.errorCode,
        completedAt: a.completedAt,
      })),
    };
  }

  async hint(userId: string, id: string) {
    // Compare-and-swap with answer submission on the same row. Exposure is durable
    // before returning, and cannot change after ASSESSING has won the race.
    for (let tries = 0; tries < 8; tries++) {
      const row = await this.owned(userId, id);
      if (row.status !== 'READY')
        throw new ConflictException('Hints require a ready practice');
      if (row.hintLevel >= 4) return presentPractice(row);
      const saved = await this.prisma.vocabularyPractice.updateMany({
        where: { id, userId, status: 'READY', hintLevel: row.hintLevel },
        data: { hintLevel: { increment: 1 } },
      });
      if (saved.count) return this.get(userId, id);
    }
    throw new ConflictException('Practice changed; reload and retry');
  }

  async answer(userId: string, id: string, input: VocabularyAnswerDto) {
    if (
      typeof input.sentence !== 'string' ||
      !input.sentence.trim() ||
      input.sentence.length > 300 ||
      !isUUID(input.requestKey)
    )
      throw new BadRequestException(
        'A sentence of up to 300 characters and a UUID requestKey are required',
      );
    await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      const row = await tx.vocabularyPractice.findUniqueOrThrow({
        where: { id },
      });
      const existing = await tx.vocabularyPracticeAttempt.findUnique({
        where: {
          practiceId_requestKey: {
            practiceId: id,
            requestKey: input.requestKey,
          },
        },
      });
      if (existing) {
        if (existing.answer !== input.sentence)
          billingError('IDEMPOTENCY_CONFLICT');
        return;
      }
      if (
        !['READY', 'COMPLETED', 'FAILED'].includes(row.status) ||
        !row.challenge
      )
        billingError('REQUEST_IN_PROGRESS');
      const submission = await this.quota?.authorizeSubmission(
        tx,
        userId,
        'VOCABULARY',
        id,
        input.requestKey,
        submissionHash(input.sentence),
      );
      const last = await tx.vocabularyPracticeAttempt.findFirst({
        where: { practiceId: id },
        orderBy: { ordinal: 'desc' },
      });
      await tx.vocabularyPracticeAttempt.create({
        data: {
          practiceId: id,
          userId,
          ordinal: (last?.ordinal ?? 0) + 1,
          requestKey: input.requestKey,
          answer: input.sentence,
          submissionId: submission?.id,
        },
      });
      await tx.vocabularyPractice.update({
        where: { id },
        data: {
          ...(row.assessment === null
            ? { answer: input.sentence, requestKey: input.requestKey }
            : {}),
          status: 'ASSESSING',
          attempts: 0,
          lockedAt: null,
          availableAt: new Date(),
          errorCode: null,
        },
      });
    });
    return this.get(userId, id);
  }

  async retry(userId: string, id: string) {
    const owned = await this.owned(userId, id);
    return this.prisma.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      const learning = await lockLearning(tx, userId, owned.vocabularyId);
      const row = await tx.vocabularyPractice.findUniqueOrThrow({
        where: { id },
        include: practiceInclude,
      });
      if (row.status !== 'FAILED')
        throw new ConflictException('Only failed practices can be retried');
      if (row.attempts >= MAX_ATTEMPTS)
        throw new ConflictException('Retry limit reached');
      if (
        row.learningRevision !== learning.manualRevision ||
        !isEnabled(learning)
      )
        throw new ConflictException('Learning changed; start a new practice');
      const active = await tx.vocabularyPractice.findFirst({
        where: { learningId: learning.id, status: { in: OPEN_STATUSES } },
      });
      if (active) throw new ConflictException('Another practice is active');
      const attempt = await tx.vocabularyPracticeAttempt.findFirst({
        where: { practiceId: id },
        orderBy: { ordinal: 'desc' },
      });
      if (attempt && this.quota) {
        await this.quota.authorizeSubmission(
          tx,
          userId,
          'VOCABULARY',
          id,
          attempt.requestKey,
          submissionHash(attempt.answer),
        );
        await tx.vocabularyPracticeAttempt.update({
          where: { id: attempt.id },
          data: { status: 'QUEUED', errorCode: null },
        });
      } else await this.quota?.authorizeTask(tx, userId, 'VOCABULARY', id);
      return presentPractice(
        await tx.vocabularyPractice.update({
          where: { id },
          data: {
            status: row.answer === null ? 'QUEUED' : 'ASSESSING',
            lockedAt: null,
            availableAt: new Date(),
            errorCode: null,
          },
          include: practiceInclude,
        }),
      );
    });
  }
}
