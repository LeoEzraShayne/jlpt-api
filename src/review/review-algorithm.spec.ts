import { RecallRating } from '@prisma/client';
import { calculateReview } from './review-algorithm';

const now = new Date('2026-08-09T00:00:00.000Z');
const run = (rating: RecallRating, aiScore?: number, isInitial = false) =>
  calculateReview({
    stage: 0,
    masteryScore: isInitial ? 0 : 20,
    rating,
    aiScore,
    isInitial,
    now,
  });

describe('calculateReview', () => {
  it('initializes completed learning at 20 percent and one day', () => {
    const result = run(RecallRating.REMEMBERED, 90, true);
    expect(result.masteryScore).toBe(20);
    expect(result.nextReviewAt.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it.each([
    [59, 'FORGOT'],
    [60, 'FUZZY'],
    [79, 'FUZZY'],
    [80, 'REMEMBERED'],
    [90, 'REMEMBERED'],
  ])('caps remembered feedback at score %s', (score, expected) => {
    expect(run(RecallRating.REMEMBERED, Number(score)).effectiveRating).toBe(
      expected,
    );
  });

  it('resets forgotten grammar and decreases mastery', () => {
    const result = calculateReview({
      stage: 4,
      masteryScore: 80,
      rating: RecallRating.FORGOT,
      isInitial: false,
      now,
    });
    expect(result).toMatchObject({
      stage: 0,
      masteryScore: 65,
      effectiveRating: RecallRating.FORGOT,
    });
  });

  it('advances a remembered review to the next interval', () => {
    const result = run(RecallRating.REMEMBERED, 86);
    expect(result).toMatchObject({ stage: 1, masteryScore: 35 });
    expect(result.nextReviewAt.toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });
});
