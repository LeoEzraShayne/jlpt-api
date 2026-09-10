import type { RecallRating } from '@prisma/client';

export function accountableActivitySeconds(
  session: { lastActivityAt: Date | null },
  now: Date,
) {
  if (!session.lastActivityAt) return 0;
  const elapsed = Math.floor(
    (now.getTime() - session.lastActivityAt.getTime()) / 1_000,
  );
  return Math.max(0, Math.min(90, elapsed));
}

export function withReviewOutcome<
  T extends object,
  E extends {
    submittedRating: RecallRating;
    effectiveRating: RecallRating;
    nextReviewOn: Date;
    scheduledDaysAfter: number;
    stabilityAfter: number | null;
    difficultyAfter: number | null;
    algorithmVersion: string;
  } | null,
>(session: T, event: E) {
  return {
    ...session,
    reviewOutcome: event
      ? {
          submittedRating: event.submittedRating,
          effectiveRating: event.effectiveRating,
          nextReviewOn: event.nextReviewOn.toISOString().slice(0, 10),
          intervalDays: event.scheduledDaysAfter,
          stabilityEstimateDays: event.stabilityAfter,
          difficultyEstimate: event.difficultyAfter,
          algorithmVersion: event.algorithmVersion,
          isEstimate: true,
        }
      : null,
  };
}
