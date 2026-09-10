import {
  MemoryStateSource,
  RecallRating,
  ReviewMemoryState,
} from '@prisma/client';
import {
  algorithmModeForUser,
  calculateAdaptiveReview,
  calendarDayDifference,
  localDateKey,
  recallPolicyForEvidence,
  resolveRating,
  SCHEDULER_PACKAGE_VERSION,
  type StoredReviewState,
} from './adaptive-review';

const now = new Date('2026-08-12T03:00:00.000Z');

describe('adaptive review policy', () => {
  it('pins the scheduler package contract', () => {
    expect(SCHEDULER_PACKAGE_VERSION).toBe('5.4.1');
  });

  it('uses AI only to lower the submitted rating', () => {
    expect(
      resolveRating(RecallRating.FUZZY, {
        totalScore: 95,
        usedTargetGrammar: true,
        targetGrammarCorrect: true,
      }).effectiveRating,
    ).toBe(RecallRating.FUZZY);
    expect(
      resolveRating(RecallRating.REMEMBERED, {
        totalScore: 79,
        usedTargetGrammar: true,
        targetGrammarCorrect: true,
      }),
    ).toEqual({
      effectiveRating: RecallRating.FUZZY,
      aiEvidence: 'QUALITY_CAP',
    });
    expect(
      resolveRating(RecallRating.REMEMBERED, {
        totalScore: 90,
        usedTargetGrammar: false,
        targetGrammarCorrect: false,
      }).effectiveRating,
    ).toBe(RecallRating.FORGOT);
  });

  it('exposes a server-owned recall policy with explicit reasons', () => {
    expect(
      recallPolicyForEvidence({
        totalScore: 95,
        usedTargetGrammar: false,
        targetGrammarCorrect: true,
      }),
    ).toMatchObject({
      allowedRatings: [RecallRating.FORGOT, RecallRating.FUZZY],
      effectiveRatingCap: RecallRating.FORGOT,
      reason: 'TARGET_GRAMMAR_MISSING',
    });
    expect(
      recallPolicyForEvidence({
        totalScore: 79,
        usedTargetGrammar: true,
        targetGrammarCorrect: true,
      }),
    ).toMatchObject({
      effectiveRatingCap: RecallRating.FUZZY,
      reason: 'SCORE_BELOW_80',
    });
  });

  it('produces deterministic bounded intervals ordered by recall quality', () => {
    const learned = calculateAdaptiveReview({
      rating: RecallRating.REMEMBERED,
      now,
      timezone: 'Asia/Tokyo',
    });
    const schedule: StoredReviewState = {
      nextReviewAt: learned.nextReviewAt,
      nextReviewOn: learned.nextReviewOn,
      lastReviewAt: now,
      stability: learned.stabilityAfter,
      difficulty: learned.difficultyAfter,
      fsrsState: learned.fsrsState,
      scheduledDays: learned.intervalDays,
      elapsedDays: learned.elapsedDays,
      reps: learned.reps,
      lapses: learned.lapses,
      stateSource: MemoryStateSource.NATIVE,
    };
    const reviewAt = new Date('2026-08-15T03:00:00.000Z');
    const intervals = [
      RecallRating.FORGOT,
      RecallRating.FUZZY,
      RecallRating.REMEMBERED,
    ].map(
      (rating) =>
        calculateAdaptiveReview({
          schedule,
          rating,
          now: reviewAt,
          timezone: 'Asia/Tokyo',
        }).intervalDays,
    );
    expect(intervals[0]).toBeLessThanOrEqual(intervals[1]);
    expect(intervals[1]).toBeLessThanOrEqual(intervals[2]);
    expect(intervals.every((value) => value >= 1 && value <= 365)).toBe(true);
    expect(learned.fsrsState).toBe(ReviewMemoryState.REVIEW);
  });

  it('uses stable rollout buckets and calendar days across DST', () => {
    expect(algorithmModeForUser('adaptive', 0, 'user-1')).toBe('shadow');
    expect(algorithmModeForUser('adaptive', 100, 'user-1')).toBe('adaptive');
    const before = new Date('2026-03-08T06:30:00.000Z');
    const after = new Date('2026-03-09T05:30:00.000Z');
    expect(localDateKey('America/New_York', before)).toBe('2026-03-08');
    expect(localDateKey('America/New_York', after)).toBe('2026-03-09');
    expect(calendarDayDifference('2026-03-08', '2026-03-09')).toBe(1);
  });
});
