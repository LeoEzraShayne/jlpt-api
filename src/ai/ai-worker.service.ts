import { QuotaService } from '../billing/quota.service';
import { lockBillingUser } from '../billing/entitlement.service';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { AiJobStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { SceneService } from '../scenes/scenes.service';
import { readTrainingContext } from '../scenes/training-context';
import { ProviderError } from './ai-provider';
import { AiReviewService } from './ai-review.service';
import { claimReview, leaseWhere, type ReviewLease } from './review-job-lease';
import { jobInput, reviewJobInclude } from './review-job-context';
import { PROMPT_VERSION } from './prompt';
import { AI_SCORE_POLICY_VERSION } from '../review/adaptive-review';

@Injectable()
export class AiWorkerService {
  private readonly logger = new Logger(AiWorkerService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: AiReviewService,
    private readonly config: ConfigService,
    @Optional() private readonly scenes?: SceneService,
    @Optional() private readonly quota?: QuotaService,
  ) {}

  @Interval(500)
  async poll() {
    if (this.running || !this.config.get<boolean>('AI_WORKER_ENABLED')) return;
    this.running = true;
    try {
      const claimed = await claimReview(this.prisma);
      if (claimed) await this.process(claimed);
    } catch (error) {
      this.logger.error(
        `AI worker poll failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async process(lease: ReviewLease) {
    const id = lease.id;
    const job = await this.prisma.aiReviewJob.findUnique({
      where: { id },
      include: reviewJobInclude,
    });
    if (!job) return;
    try {
      const trainingContext = readTrainingContext(
        job.attempt.studySession.trainingContext,
      );
      const reviewed = await this.reviews.review({
        ...jobInput(job),
        stage: 'CORE',
      });
      const result = reviewed.response.result;
      const cappedTotal = !result.used_target_grammar
        ? Math.min(result.total_score, 30)
        : !result.target_grammar_correct
          ? Math.min(result.total_score, 59)
          : result.total_score;
      const saved = await this.prisma.$transaction(async (tx) => {
        if (this.quota) await lockBillingUser(tx, job.attempt.userId);
        const guard = await tx.aiReviewJob.updateMany({
          where: leaseWhere(lease),
          data: {
            status: AiJobStatus.COMPLETED,
            provider: reviewed.provider,
            errorCode: null,
            errorMessage: null,
          },
        });
        if (guard.count !== 1) return false;
        await tx.aiReviewResult.create({
          data: {
            jobId: id,
            provider: reviewed.provider,
            model: reviewed.response.model,
            promptVersion: PROMPT_VERSION,
            rawTotalScore: result.total_score,
            totalScore: cappedTotal,
            grammarScore: result.grammar_score,
            connectionScore: result.connection_score,
            completenessScore: result.completeness_score,
            naturalnessScore: result.naturalness_score,
            vocabularyScore: result.vocabulary_score,
            isCorrect: result.is_correct,
            usedTargetGrammar: result.used_target_grammar,
            targetGrammarCorrect: result.target_grammar_correct,
            scorePolicyVersion: AI_SCORE_POLICY_VERSION,
            resultLevel: result.result_level,
            errorSpans: result.error_spans,
            correctedSentence: result.corrected_sentence,
            correctedSentenceFurigana: result.corrected_sentence_furigana,
            correctedSentenceTranslationZh:
              result.corrected_sentence_translation_zh,
            explanationZh: result.explanation_zh,
            encouragement: result.encouragement,
            scenarioTaskCompleted:
              trainingContext?.scenario &&
              trainingContext.scenario.scenarioId ===
                job.attempt.studySession.scenarioId
                ? (result.scenario_task_completed ?? null)
                : null,
            inputTokens: reviewed.response.usage.inputTokens,
            outputTokens: reviewed.response.usage.outputTokens,
            latencyMs: reviewed.response.latencyMs,
          },
        });
        if (this.quota) {
          const submission = await tx.taskSubmission.findFirst({
            where: {
              resultId: id,
              userId: job.attempt.userId,
              status: 'PENDING',
            },
          });
          if (submission)
            await this.quota.completeSubmission(tx, submission.id, id);
        }
        return true;
      });
      if (!saved) return;
      await this.scenes
        ?.recordUsed(
          job.attempt.userId,
          job.attempt.studySessionId,
          trainingContext,
          job.attempt.sentence,
          '',
        )
        .catch(() =>
          this.logger.warn(
            'Exposure tracking unavailable; completed correction preserved',
          ),
        );
    } catch (error) {
      await this.fail(lease, job.retryCount, error);
    }
  }

  private async fail(lease: ReviewLease, retryCount: number, error: unknown) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(
            'Unexpected AI worker error',
            'AI_INTERNAL_ERROR',
            true,
          );
    const retry = providerError.retryable && retryCount < 2;
    const update = async (
      tx: import('@prisma/client').Prisma.TransactionClient | PrismaService,
    ) =>
      tx.aiReviewJob.updateMany({
        where: leaseWhere(lease),
        data: {
          status: retry ? AiJobStatus.QUEUED : AiJobStatus.FAILED,
          retryCount: { increment: 1 },
          errorCode: providerError.code,
          errorMessage: providerError.message.slice(0, 500),
          availableAt: retry
            ? new Date(Date.now() + (retryCount + 1) * 30_000)
            : new Date(),
          lockedAt: null,
        },
      });
    if (!this.quota) {
      await update(this.prisma);
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.aiReviewJob.findUniqueOrThrow({
        where: { id: lease.id },
        include: { attempt: true },
      });
      await lockBillingUser(tx, job.attempt.userId);
      const saved = await update(tx);
      if (saved.count && !retry) {
        const submission = await tx.taskSubmission.findFirst({
          where: { resultId: lease.id, status: 'PENDING' },
        });
        if (submission) await this.quota!.failSubmission(tx, submission.id);
      }
    });
  }
}
