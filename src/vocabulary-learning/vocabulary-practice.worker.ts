import { Injectable, Logger } from '@nestjs/common';
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
        const assessment = await this.ai.assess(input, challenge, job.answer);
        await this.complete(lease, job, assessment);
      }
    } catch {
      await this.fail(lease, 'AI_FAILED');
    }
  }

  private async complete(
    lease: VocabularyLease,
    job: PracticeRecord,
    assessment: WordAssessment,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: job.userId },
      select: { timezone: true },
    });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
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
        return;
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
      if (result.data)
        await tx.vocabularyLearning.update({
          where: { id: learning.id },
          data: result.data,
        });
    });
  }

  private async fail(lease: VocabularyLease, errorCode: string) {
    await this.prisma.vocabularyPractice.updateMany({
      where: vocabularyLeaseWhere(lease),
      data: { status: 'FAILED', lockedAt: null, errorCode },
    });
  }
}
