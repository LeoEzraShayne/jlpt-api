export const NEW_GRAMMAR_MINUTES = 8;
export const REVIEW_MINUTES = 4;
export const NEEDS_WORK_REVIEW_MINUTES = 6;

export type ReviewCandidate = {
  grammarId: string;
  nextReviewAt: Date;
  priorityDay?: string;
  status: string;
  masteryScore: number;
  lastScore: number | null;
  estimatedRetrievability?: number | null;
  stability?: number | null;
};

export function isNeedsWork(
  candidate: Pick<ReviewCandidate, 'status' | 'lastScore'>,
) {
  return candidate.status === 'NEEDS_WORK' || (candidate.lastScore ?? 100) < 60;
}

export function reviewMinutes(
  candidate: Pick<ReviewCandidate, 'status' | 'lastScore'>,
) {
  return isNeedsWork(candidate) ? NEEDS_WORK_REVIEW_MINUTES : REVIEW_MINUTES;
}

export function sortReviewCandidates<T extends ReviewCandidate>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftDay =
      left.priorityDay ?? left.nextReviewAt.toISOString().slice(0, 10);
    const rightDay =
      right.priorityDay ?? right.nextReviewAt.toISOString().slice(0, 10);
    const dayDifference = leftDay.localeCompare(rightDay);
    if (dayDifference) return dayDifference;
    const retrievabilityDifference =
      (left.estimatedRetrievability ?? 1) -
      (right.estimatedRetrievability ?? 1);
    if (retrievabilityDifference) return retrievabilityDifference;
    const needsWorkDifference =
      Number(isNeedsWork(right)) - Number(isNeedsWork(left));
    if (needsWorkDifference) return needsWorkDifference;
    const stabilityDifference =
      (left.stability ?? Number.MAX_SAFE_INTEGER) -
      (right.stability ?? Number.MAX_SAFE_INTEGER);
    if (stabilityDifference) return stabilityDifference;
    const masteryDifference = left.masteryScore - right.masteryScore;
    if (masteryDifference) return masteryDifference;
    const leftScore = left.lastScore ?? 100;
    const rightScore = right.lastScore ?? 100;
    if (leftScore !== rightScore) return leftScore - rightScore;
    const dueDifference =
      left.nextReviewAt.getTime() - right.nextReviewAt.getTime();
    if (dueDifference) return dueDifference;
    return left.grammarId.localeCompare(right.grammarId);
  });
}

export function selectReviews<T extends ReviewCandidate>(
  candidates: T[],
  dailyMinutes: number,
  alreadyUsedMinutes = 0,
  estimateMinutes: (candidate: T) => number = reviewMinutes,
) {
  const budget = Math.max(0, dailyMinutes);
  const selected: T[] = [];
  let selectedMinutes = alreadyUsedMinutes;
  for (const candidate of sortReviewCandidates(candidates)) {
    const minutes = estimateMinutes(candidate);
    const hasPlannedWork = alreadyUsedMinutes > 0 || selected.length > 0;
    if (hasPlannedWork && selectedMinutes + minutes > budget) break;
    selected.push(candidate);
    selectedMinutes += minutes;
  }
  return { selected, selectedMinutes };
}

export function calculateNewGrammarCount({
  dailyMinutes,
  dailyNewLimit,
  usedMinutes,
  hasDueReviews,
  preservedNewCount = 0,
  newGrammarMinutes = NEW_GRAMMAR_MINUTES,
}: {
  dailyMinutes: number;
  dailyNewLimit: number;
  usedMinutes: number;
  hasDueReviews: boolean;
  preservedNewCount?: number;
  newGrammarMinutes?: number;
}) {
  const remainingLimit = Math.max(0, dailyNewLimit - preservedNewCount);
  const remainingMinutes = Math.max(0, dailyMinutes - usedMinutes);
  const fitted = Math.floor(remainingMinutes / newGrammarMinutes);
  if (!hasDueReviews && preservedNewCount === 0 && remainingLimit > 0)
    return Math.min(remainingLimit, Math.max(1, fitted));
  return Math.min(remainingLimit, fitted);
}
