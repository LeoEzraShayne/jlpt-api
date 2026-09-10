import { RecallRating } from '@prisma/client';

const intervals = [1, 3, 7, 14, 30, 60];
const milestones = [20, 35, 50, 65, 80, 90, 100];

export interface ReviewInput {
  stage: number;
  masteryScore: number;
  rating: RecallRating;
  aiScore?: number;
  isInitial: boolean;
  now?: Date;
}
export interface ReviewOutcome {
  effectiveRating: RecallRating;
  stage: number;
  masteryScore: number;
  nextReviewAt: Date;
  correct: boolean;
}

export function calculateReview(input: ReviewInput): ReviewOutcome {
  const effectiveRating = capRating(input.rating, input.aiScore);
  let stage = Math.max(0, Math.min(input.stage, intervals.length));
  let masteryScore = input.isInitial
    ? Math.max(input.masteryScore, 20)
    : input.masteryScore;
  let days = 1;
  if (effectiveRating === RecallRating.FORGOT) {
    stage = 0;
    masteryScore = Math.max(0, masteryScore - 15);
  } else if (effectiveRating === RecallRating.FUZZY) {
    days = Math.min(3, intervals[Math.min(stage, intervals.length - 1)]);
  } else if (input.isInitial) {
    stage = 0;
    masteryScore = Math.max(masteryScore, milestones[0]);
  } else {
    stage = Math.min(stage + 1, intervals.length);
    masteryScore = Math.max(masteryScore, milestones[stage]);
    days = intervals[Math.min(stage, intervals.length - 1)];
  }
  const nextReviewAt = new Date(
    (input.now ?? new Date()).getTime() + days * 86_400_000,
  );
  return {
    effectiveRating,
    stage,
    masteryScore,
    nextReviewAt,
    correct: effectiveRating === RecallRating.REMEMBERED,
  };
}

function capRating(rating: RecallRating, score?: number) {
  if (score === undefined) return rating;
  if (score < 60) return RecallRating.FORGOT;
  if (score < 80 && rating === RecallRating.REMEMBERED)
    return RecallRating.FUZZY;
  return rating;
}
