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
    evidenceVersion?: string;
    dueReview?: boolean;
    firstScore?: number | null;
    aiScore?: number | null;
    targetGrammarCorrect?: boolean | null;
    hintRevealCount?: number;
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
          evidenceVersion: event.evidenceVersion ?? 'legacy-v1',
          dueReview: event.dueReview ?? false,
          assessmentAvailable:
            (event.evidenceVersion === 'mastery-v2'
              ? event.firstScore
              : event.aiScore) != null,
          eligibleMasteryReview:
            event.evidenceVersion === 'mastery-v2' &&
            event.dueReview === true &&
            (event.firstScore ?? -1) >= 80 &&
            event.targetGrammarCorrect === true &&
            event.hintRevealCount === 0 &&
            event.submittedRating === 'REMEMBERED' &&
            event.effectiveRating === 'REMEMBERED',
          nextReviewStillDue: event.scheduledDaysAfter <= 0,
          isEstimate: true,
        }
      : null,
  };
}
