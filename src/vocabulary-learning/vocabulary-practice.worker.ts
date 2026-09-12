import { QuotaService } from '../billing/quota.service';
import { lockBillingUser } from '../billing/entitlement.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service';
import { VocabularyAiService } from './vocabulary-ai.service';
import type { WordAssessment } from './vocabulary-ai.schema';
import { lockLearning } from './vocabulary-learning.db';
import { isEnabled, visibleVocabulary } from './vocabulary-learning.policy';
import { localDayBounds } from './vocabulary-learning.service';
import { scheduleWord } from './vocabulary-evidence';
import {
  vocabularyInput,
  storedVocabularyInput,
} from './vocabulary-practice.context';
import {
  claimVocabularyPractice,
  vocabularyLeaseWhere,
  type VocabularyLease,
} from './vocabulary-practice.lease';
import {
  practiceInclude,
  readChallenge,
  type PracticeRecord,
} from './vocabulary-practice.presenter';

@Injectable()
export class VocabularyPracticeWorker {
  private running = false;
  private readonly logger = new Logger(VocabularyPracticeWorker.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: VocabularyAiService,
    private readonly config: ConfigService,
    @Optional() private readonly quota?: QuotaService,
  ) {}

  @Interval(1000)
  async poll() {
    const enabled = this.config.get<boolean | string>('AI_WORKER_ENABLED');
    if (enabled !== true && enabled !== 'true') return;
    await this.processOne();
  }

  /** Explicit single-job execution for integration tests/operations. The timer alone honors the enable flag. */
  async processOne() {
    if (this.running) return;
    this.running = true;
    try {
      const lease = await claimVocabularyPractice(this.prisma);
      if (lease) await this.process(lease);
    } catch {
      // Do not log provider payloads or a user's sentence.
      this.logger.error('Vocabulary worker poll failed');
    } finally {
      this.running = false;
    }
  }

  private async process(lease: VocabularyLease) {
    const job = await this.prisma.vocabularyPractice.findFirst({
      where: vocabularyLeaseWhere(lease),
      include: practiceInclude,
    });
    if (!job) return;
    try {
      const visible = await this.prisma.vocabularyEntry.findFirst({
        where: { id: job.vocabularyId, ...visibleVocabulary(job.userId) },
        select: { id: true },
      });
      if (
        !visible ||
        job.learningRevision !== job.learning.manualRevision ||
        !isEnabled(job.learning)
      ) {
        await this.fail(lease, 'LEARNING_CHANGED');
        return;
      }
      if (job.answer === null) {
        const input = await vocabularyInput(this.prisma, job);
        const challenge = await this.ai.generate(input);
        if (
          challenge.grammarId !== null &&
          !input.grammars.some((g) => g.id === challenge.grammarId)
        )
          throw new Error('Invalid grammar selection');
        await this.prisma.vocabularyPractice.updateMany({
          where: vocabularyLeaseWhere(lease),
          data: {
            status: 'READY',
            grammarId: challenge.grammarId,
            challenge: { ...challenge, _input: input },
            lockedAt: null,
            attempts: 0,
            errorCode: null,
          },
        });
      } else {
        const challenge = readChallenge(job.challenge);
        const input = storedVocabularyInput(job);
        if (!challenge || !input) throw new Error('Missing challenge context');
        const attempt = this.quota
          ? await this.prisma.vocabularyPracticeAttempt.findFirst({
              where: { practiceId: job.id, status: 'QUEUED' },
              orderBy: { ordinal: 'desc' },
            })
          : null;
        const assessment = await this.ai.assess(
          input,
          challenge,
          attempt?.answer ?? job.answer,
        );
        await this.complete(lease, job, assessment, attempt?.id);
      }
    } catch {
      await this.fail(lease, 'AI_FAILED');
    }
  }

  private async complete(
    lease: VocabularyLease,
    job: PracticeRecord,
    assessment: WordAssessment,
    attemptId?: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: job.userId },
      select: { timezone: true },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (this.quota) await lockBillingUser(tx, job.userId);
      const learning = await lockLearning(tx, job.userId, job.vocabularyId);
      const visible = await tx.vocabularyEntry.findFirst({
        where: { id: job.vocabularyId, ...visibleVocabulary(job.userId) },
        select: { id: true },
      });
      if (
        !visible ||
        job.learningRevision !== learning.manualRevision ||
        !isEnabled(learning)
      ) {
        await tx.vocabularyPractice.updateMany({
          where: vocabularyLeaseWhere(lease),
          data: {
            status: 'FAILED',
            lockedAt: null,
            errorCode: 'LEARNING_CHANGED',
          },
        });
        if (this.quota && attemptId) {
          const attempt = await tx.vocabularyPracticeAttempt.update({
            where: { id: attemptId },
            data: { status: 'FAILED', errorCode: 'LEARNING_CHANGED' },
          });
          if (attempt.submissionId)
            await this.quota.failSubmission(tx, attempt.submissionId);
        }
        return;
      }
      if (job.assessment !== null) {
        const saved = await tx.vocabularyPractice.updateMany({
          where: vocabularyLeaseWhere(lease),
          data: { status: 'COMPLETED', lockedAt: null, errorCode: null },
        });
        if (saved.count && attemptId)
          await this.completeAttempt(tx, attemptId, assessment, now);
        return; // Corrections never update the original evidence or FSRS memory.
      }
      const earlier = await tx.vocabularyPractice.findFirst({
        where: {
          learningId: learning.id,
          id: { not: job.id },
          status: { in: ['COMPLETED', 'FAILED'] },
          answer: { not: null },
          dueAtStart: true,
          // An unverified due attempt also consumes its evidence opportunity. Later
          // repetitions cannot cherry-pick a success to inflate the day's interval.
          OR: [
            { completedAt: localDayBounds(user.timezone, now) },
            { createdAt: localDayBounds(user.timezone, job.createdAt) },
          ],
        },
        orderBy: [{ hintLevel: 'desc' }, { unknownAtStart: 'desc' }],
        select: { id: true, hintLevel: true, unknownAtStart: true },
      });
      // Failed submitted attempts retain their hint exposure across replacement jobs.
      const effectivePractice = {
        ...job,
        hintLevel: Math.max(
          job.hintLevel,
          earlier?.hintLevel ?? 0,
          earlier?.unknownAtStart ? 3 : 0,
        ),
      };
      const result = scheduleWord({
        learning,
        practice: effectivePractice,
        assessment,
        now,
        timezone: user.timezone,
        earlierDueAttempt: !!earlier,
      });
      const saved = await tx.vocabularyPractice.updateMany({
        where: vocabularyLeaseWhere(lease),
        data: {
          status: 'COMPLETED',
          completedAt: now,
          assessment,
          counted: result.counted,
          hintLevel: effectivePractice.hintLevel,
          lockedAt: null,
          errorCode: null,
        },
      });
      if (!saved.count) return; // A recovered worker owns the lease now.
      if (attemptId) await this.completeAttempt(tx, attemptId, assessment, now);
      if (result.data)
        await tx.vocabularyLearning.update({
          where: { id: learning.id },
          data: result.data,
        });
    });
  }

  private async completeAttempt(
    tx: import('@prisma/client').Prisma.TransactionClient,
    id: string,
    assessment: WordAssessment,
    now: Date,
  ) {
    const attempt = await tx.vocabularyPracticeAttempt.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        assessment,
        completedAt: now,
        errorCode: null,
      },
    });
    if (attempt.submissionId)
      await this.quota?.completeSubmission(
        tx,
        attempt.submissionId,
        attempt.id,
      );
  }

  private async fail(lease: VocabularyLease, errorCode: string) {
    if (!this.quota) {
      await this.prisma.vocabularyPractice.updateMany({
        where: vocabularyLeaseWhere(lease),
        data: { status: 'FAILED', lockedAt: null, errorCode },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.vocabularyPractice.findUniqueOrThrow({
        where: { id: lease.id },
      });
      await lockBillingUser(tx, job.userId);
      const saved = await tx.vocabularyPractice.updateMany({
        where: vocabularyLeaseWhere(lease),
        data: { status: 'FAILED', lockedAt: null, errorCode },
      });
      if (!saved.count) return;
      const attempts = await tx.vocabularyPracticeAttempt.findMany({
        where: { practiceId: job.id, status: 'QUEUED' },
      });
      for (const attempt of attempts) {
        await tx.vocabularyPracticeAttempt.update({
          where: { id: attempt.id },
          data: { status: 'FAILED', errorCode },
        });
        if (attempt.submissionId)
          await this.quota!.failSubmission(tx, attempt.submissionId);
      }
      await this.quota!.releaseTask(tx, job.userId, 'VOCABULARY', job.id);
    });
  }
}
