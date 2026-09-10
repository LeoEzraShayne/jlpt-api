import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { AiJobStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ProviderError } from './ai-provider';
import { AiReviewService } from './ai-review.service';
import { PROMPT_VERSION } from './prompt';
import { AI_SCORE_POLICY_VERSION } from '../review/adaptive-review';

interface ClaimedJob {
  id: string;
}

@Injectable()
export class AiWorkerService {
  private readonly logger = new Logger(AiWorkerService.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: AiReviewService,
    private readonly config: ConfigService,
  ) {}

  @Interval(500)
  async poll() {
    if (this.running || !this.config.get<boolean>('AI_WORKER_ENABLED')) return;
    this.running = true;
    try {
      const claimed = await this.prisma.$queryRaw<ClaimedJob[]>(Prisma.sql`
        UPDATE "AiReviewJob" SET status = 'PROCESSING', "lockedAt" = NOW(), "updatedAt" = NOW()
        WHERE id = (SELECT id FROM "AiReviewJob" WHERE status = 'QUEUED' AND "availableAt" <= NOW() ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`);
      if (claimed[0]) await this.process(claimed[0].id);
    } catch (error) {
      this.logger.error(
        `AI worker poll failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async process(id: string) {
    const job = await this.prisma.aiReviewJob.findUnique({
      where: { id },
      include: {
        attempt: {
          include: {
            grammar: {
              include: { examples: { take: 1, orderBy: { sortOrder: 'asc' } } },
            },
          },
        },
      },
    });
    if (!job) return;
    try {
      const reviewed = await this.reviews.review({
        grammarLevel: job.attempt.grammar.level,
        grammarTitle: job.attempt.grammar.title,
        explanation: job.attempt.grammar.chineseExplanation,
        connectionRule: job.attempt.grammar.connectionRule,
        exampleSentence: job.attempt.grammar.examples[0]?.sentence,
        sentence: job.attempt.sentence,
        scene: job.attempt.scene,
      });
      const result = reviewed.response.result;
      const cappedTotal = !result.used_target_grammar
        ? Math.min(result.total_score, 30)
        : !result.target_grammar_correct
          ? Math.min(result.total_score, 59)
          : result.total_score;
      await this.prisma.$transaction([
        this.prisma.aiReviewResult.create({
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
            alternativeSentence: result.alternative_sentence,
            alternativeSentenceFurigana: result.alternative_sentence_furigana,
            alternativeSentenceTranslationZh:
              result.alternative_sentence_translation_zh,
            explanationZh: result.explanation_zh,
            encouragement: result.encouragement,
            inputTokens: reviewed.response.usage.inputTokens,
            outputTokens: reviewed.response.usage.outputTokens,
            latencyMs: reviewed.response.latencyMs,
          },
        }),
        this.prisma.aiReviewJob.update({
          where: { id },
          data: {
            status: AiJobStatus.COMPLETED,
            provider: reviewed.provider,
            errorCode: null,
            errorMessage: null,
          },
        }),
      ]);
    } catch (error) {
      await this.fail(job.id, job.retryCount, error);
    }
  }

  private async fail(id: string, retryCount: number, error: unknown) {
    const providerError =
      error instanceof ProviderError
        ? error
        : new ProviderError(
            'Unexpected AI worker error',
            'AI_INTERNAL_ERROR',
            true,
          );
    const retry = providerError.retryable && retryCount < 2;
    await this.prisma.aiReviewJob.update({
      where: { id },
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
  }
}
