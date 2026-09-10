import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { suggestionUsesTargetGrammar } from '../ai/target-grammar';
import { validFurigana } from '../ai/review-schema';
import type { ExpressionQueryDto, SaveExpressionDto } from './content.dto';

@Injectable()
export class ExpressionsService {
  constructor(private readonly prisma: PrismaService) {}
  async save(userId: string, dto: SaveExpressionDto) {
    const job = await this.prisma.aiReviewJob.findFirst({
      where: { id: dto.reviewId, attempt: { userId } },
      include: {
        result: true,
        attempt: { include: { grammar: true, studySession: true } },
      },
    });
    if (!job) throw new NotFoundException('Sentence review not found');
    const result = job.result;
    if (job.status !== 'COMPLETED' || !result)
      throw new BadRequestException(
        'Only completed checked reviews can be saved',
      );
    const original = dto.variant === 'ORIGINAL';
    if (
      original &&
      !(
        result.isCorrect &&
        result.usedTargetGrammar === true &&
        result.targetGrammarCorrect === true
      )
    )
      throw new BadRequestException(
        'Original sentence must be checked correct with the target grammar',
      );
    const alternative = dto.variant === 'ALTERNATIVE';
    const sentence = original
      ? job.attempt.sentence
      : alternative
        ? result.alternativeSentence
        : result.correctedSentence;
    // Suggestions are validated by the AI review pipeline; recheck target at save.
    if (
      !sentence ||
      !suggestionUsesTargetGrammar(job.attempt.grammar.title, sentence)
    )
      throw new BadRequestException(
        'A checked suggestion using the target grammar is required',
      );
    const furigana = original
      ? null
      : alternative
        ? result.alternativeSentenceFurigana
        : result.correctedSentenceFurigana;
    const translationZh = original
      ? null
      : alternative
        ? result.alternativeSentenceTranslationZh
        : result.correctedSentenceTranslationZh;
    if (
      !original &&
      (!furigana || !translationZh || !validFurigana(sentence, furigana))
    )
      throw new BadRequestException(
        'Suggestion is missing checked reading or translation',
      );
    const session = job.attempt.studySession;
    const scenarioId =
      'scenarioId' in session && typeof session.scenarioId === 'string'
        ? session.scenarioId
        : null;
    return this.prisma.personalExpression.upsert({
      where: {
        userId_reviewId_variant: {
          userId,
          reviewId: dto.reviewId,
          variant: dto.variant,
        },
      },
      create: {
        userId,
        grammarId: job.attempt.grammarId,
        reviewId: dto.reviewId,
        variant: dto.variant,
        sentence,
        furigana,
        translationZh,
        scenarioId,
        scene: job.attempt.scene,
        note: dto.note,
        provenance: {
          attemptId: job.attempt.id,
          sessionId: session.id,
          source: 'AI_REVIEW',
          promptVersion: result.promptVersion,
          scorePolicyVersion: result.scorePolicyVersion,
          checkedAt: result.createdAt.toISOString(),
          variant: dto.variant,
        },
      },
      update: { ...(dto.note === undefined ? {} : { note: dto.note }) },
    });
  }
  async list(userId: string, query: ExpressionQueryDto) {
    const limit = query.limit ?? 30;
    const rows = await this.prisma.personalExpression.findMany({
      where: {
        userId,
        grammarId: query.grammarId,
        ...(query.query ? { sentence: { contains: query.query } } : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async update(userId: string, id: string, note?: string) {
    const existing = await this.prisma.personalExpression.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Expression not found');
    return this.prisma.personalExpression.update({
      where: { id },
      data: { note },
    });
  }
  async remove(userId: string, id: string) {
    const result = await this.prisma.personalExpression.deleteMany({
      where: { id, userId },
    });
    if (!result.count) throw new NotFoundException('Expression not found');
    return { deleted: true };
  }
}
