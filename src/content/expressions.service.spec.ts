const containing = (value: Record<string, unknown>): unknown =>
  expect.objectContaining(value);
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ExpressionsService } from './expressions.service';
import { PrismaService } from '../database/prisma.service';

const job = () => ({
  id: 'review',
  status: 'COMPLETED',
  result: {
    isCorrect: true,
    usedTargetGrammar: true,
    targetGrammarCorrect: true,
    correctedSentence: '雨にもかかわらず、出かけました。',
    correctedSentenceFurigana: '雨[あめ]にもかかわらず、出[で]かけました。',
    correctedSentenceTranslationZh: '尽管下雨，还是出门了。',
    promptVersion: 'v2',
    scorePolicyVersion: 'v1',
    createdAt: new Date(),
  },
  attempt: {
    id: 'attempt',
    grammarId: 'g',
    sentence: '雨にもかかわらず、出かけた。',
    grammar: { title: 'にもかかわらず' },
    scene: 'travel',
    studySession: { id: 's', scenarioId: 'sc' },
  },
});
function setup(value: unknown = job()) {
  const prisma = {
    aiReviewJob: { findFirst: jest.fn().mockResolvedValue(value) },
    personalExpression: { upsert: jest.fn().mockResolvedValue({ id: 'e' }) },
  };
  return {
    prisma,
    service: new ExpressionsService(prisma as unknown as PrismaService),
  };
}
describe('checked expression collection', () => {
  it('filters source review by authenticated owner', async () => {
    const { prisma, service } = setup(null);
    await expect(
      service.save('other', { reviewId: 'review', variant: 'ORIGINAL' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.aiReviewJob.findFirst).toHaveBeenCalledWith(
      containing({
        where: {
          id: 'review',
          attempt: { userId: 'other' },
        },
      }),
    );
  });
  it('does not accept unchecked originals or missing target evidence', async () => {
    const source = job();
    source.result.targetGrammarCorrect = false;
    const { service, prisma } = setup(source);
    await expect(
      service.save('u', { reviewId: 'review', variant: 'ORIGINAL' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.personalExpression.upsert).not.toHaveBeenCalled();
  });
  it('saves a checked correction even when the submitted original was wrong', async () => {
    const source = job();
    source.result.isCorrect = false;
    const { service, prisma } = setup(source);
    await service.save('u', {
      reviewId: 'review',
      variant: 'CORRECTION',
      note: '旅行で使う',
    });
    expect(prisma.personalExpression.upsert).toHaveBeenCalledWith(
      containing({
        create: containing({
          userId: 'u',
          scenarioId: 'sc',
          grammarId: 'g',
          variant: 'CORRECTION',
          sentence: source.result.correctedSentence,
        }),
        where: {
          userId_reviewId_variant: {
            userId: 'u',
            reviewId: 'review',
            variant: 'CORRECTION',
          },
        },
      }),
    );
  });
  it('rejects unavailable alternatives and corrections that omit the target', async () => {
    const { service } = setup();
    await expect(
      service.save('u', { reviewId: 'review', variant: 'ALTERNATIVE' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const source = job();
    source.result.correctedSentence = '雨が降った。';
    await expect(
      setup(source).service.save('u', {
        reviewId: 'review',
        variant: 'CORRECTION',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
