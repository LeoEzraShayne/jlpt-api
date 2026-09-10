import {
  RecallRating,
  ReviewMemoryState,
  MemoryStateSource,
} from '@prisma/client';
import { calculateEvidenceReview } from './evidence-scheduling';
import {
  calculateAdaptiveReview,
  type StoredReviewState,
} from './adaptive-review';

const schedule: StoredReviewState = {
  nextReviewAt: new Date('2026-08-20T00:00:00Z'),
  nextReviewOn: new Date('2026-08-20T00:00:00Z'),
  lastReviewAt: new Date('2026-07-20T00:00:00Z'),
  stability: 30,
  difficulty: 5,
  fsrsState: ReviewMemoryState.REVIEW,
  scheduledDays: 31,
  elapsedDays: 31,
  reps: 5,
  lapses: 0,
  stateSource: MemoryStateSource.NATIVE,
};
const input = {
  schedule,
  now: new Date('2026-08-20T03:00:00Z'),
  timezone: 'Asia/Tokyo',
  rating: RecallRating.REMEMBERED,
  hasScore: true,
  dueReview: true,
  initial: false,
};

describe('evidence-constrained FSRS', () => {
  it('uses the same FSRS outcome as planning for a qualified due review', () => {
    const actual = calculateEvidenceReview(input);
    expect(actual.nextReviewOn).toEqual(
      calculateAdaptiveReview(input).nextReviewOn,
    );
    expect(actual.stabilityAfter).toBeGreaterThan(30);
  });
  it('does not extend dates or stability when the first result is missing', () => {
    const actual = calculateEvidenceReview({
      ...input,
      rating: RecallRating.FUZZY,
      hasScore: false,
    });
    expect(actual.nextReviewOn).toEqual(schedule.nextReviewOn);
    expect(actual.stabilityAfter).toBe(30);
    expect(actual.applyFsrs).toBe(false);
  });
  it('does not extend for early practice or same-day retries', () => {
    const actual = calculateEvidenceReview({ ...input, dueReview: false });
    expect(actual.nextReviewOn).toEqual(schedule.nextReviewOn);
    expect(actual.affectsSchedule).toBe(false);
  });
  it('shortens a mature card after fuzzy or forgotten recall', () => {
    for (const rating of [RecallRating.FUZZY, RecallRating.FORGOT]) {
      const actual = calculateEvidenceReview({
        ...input,
        rating,
        dueReview: false,
        now: new Date('2026-08-10T03:00:00Z'),
      });
      expect(actual.nextReviewOn.toISOString().slice(0, 10)).toBe('2026-08-11');
    }
  });
  it('schedules a graded overdue lapse tomorrow, not back into the past', () => {
    const actual = calculateEvidenceReview({
      ...input,
      rating: RecallRating.FORGOT,
      now: new Date('2026-09-10T03:00:00Z'),
    });
    expect(actual.nextReviewOn.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(actual.intervalDays).toBe(1);
  });
  it('keeps an unscored overdue card due without increasing stability', () => {
    const actual = calculateEvidenceReview({
      ...input,
      rating: RecallRating.FUZZY,
      hasScore: false,
      now: new Date('2026-09-10T03:00:00Z'),
    });
    expect(actual.nextReviewOn).toEqual(schedule.nextReviewOn);
    expect(actual.stabilityAfter).toBe(30);
  });
  it('gives an unscored initial check a short date without fabricated FSRS state', () => {
    const actual = calculateEvidenceReview({
      ...input,
      schedule: null,
      rating: RecallRating.FUZZY,
      initial: true,
      dueReview: false,
      hasScore: false,
    });
    expect(actual.intervalDays).toBe(1);
    expect(actual.stabilityAfter).toBeNull();
    expect(actual.applyFsrs).toBe(false);
  });
});
