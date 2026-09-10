import { RecallRating } from '@prisma/client';
import {
  addCalendarDays,
  calculateAdaptiveReview,
  calendarDayDifference,
  localDateKey,
  type StoredReviewState,
} from './adaptive-review';

/** Shared FSRS scheduling plus evidence restrictions; suitable for forecasts too. */
export function calculateEvidenceReview(input: {
  schedule?: StoredReviewState | null;
  rating: RecallRating;
  hasScore: boolean;
  dueReview: boolean;
  initial: boolean;
  now: Date;
  timezone: string;
}) {
  const { schedule, now, timezone, rating } = input;
  const outcome = calculateAdaptiveReview(input);
  const today = localDateKey(timezone, now);
  const existingKey =
    schedule?.nextReviewOn?.toISOString().slice(0, 10) ??
    (schedule ? localDateKey(timezone, schedule.nextReviewAt) : null);
  const success = rating === RecallRating.REMEMBERED && input.hasScore;
  const applyFsrs =
    input.hasScore && (input.dueReview || input.initial || !success);
  let nextKey = outcome.nextReviewOn.toISOString().slice(0, 10);
  if (!success) {
    // Hard/failed checks must shorten rather than accidentally lengthen a mature card.
    nextKey = [
      nextKey,
      addCalendarDays(today, 1),
      ...(existingKey ? [existingKey] : []),
    ].sort()[0];
  } else if (!input.dueReview && !input.initial && existingKey) {
    nextKey = existingKey;
  }
  const affectsSchedule = !schedule || applyFsrs || nextKey !== existingKey;
  const intervalDays = calendarDayDifference(today, nextKey);
  return {
    outcome,
    applyFsrs,
    affectsSchedule,
    nextReviewOn: new Date(`${nextKey}T00:00:00.000Z`),
    intervalDays,
    stabilityAfter: applyFsrs
      ? outcome.stabilityAfter
      : (schedule?.stability ?? null),
    difficultyAfter: applyFsrs
      ? outcome.difficultyAfter
      : (schedule?.difficulty ?? null),
  };
}
