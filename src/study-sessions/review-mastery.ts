import { ProgressStatus, RecallRating, type SessionMode } from '@prisma/client';

type ReviewEvidence = {
  effectiveRating: RecallRating;
  hintRevealCount: number;
};

export function resolveProgressStatus(input: {
  affectsSchedule: boolean;
  reps: number;
  stabilityAfter: number;
  effectiveRating: RecallRating;
  sessionMode: SessionMode;
  hintRevealCount: number;
  recentEvents: ReviewEvidence[];
}) {
  const current: ReviewEvidence = {
    effectiveRating: input.effectiveRating,
    hintRevealCount: input.sessionMode === 'REVIEW' ? input.hintRevealCount : 0,
  };
  const lastThree = [current, ...input.recentEvents];
  const confirmedWithoutHints =
    lastThree.length === 3 &&
    lastThree.every(
      (event) =>
        event.effectiveRating === RecallRating.REMEMBERED &&
        event.hintRevealCount === 0,
    );
  if (
    input.affectsSchedule &&
    input.reps >= 5 &&
    input.stabilityAfter >= 30 &&
    confirmedWithoutHints
  )
    return ProgressStatus.MASTERED;
  return input.effectiveRating === RecallRating.FORGOT
    ? ProgressStatus.NEEDS_WORK
    : ProgressStatus.LEARNING;
}
