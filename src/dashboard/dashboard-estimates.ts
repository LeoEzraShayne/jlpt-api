import { estimatedRetrievability } from '../review/adaptive-review';
import {
  NEEDS_WORK_REVIEW_MINUTES,
  NEW_GRAMMAR_MINUTES,
  REVIEW_MINUTES,
} from './task-planning';

export function safeRetrievability(
  schedule: Parameters<typeof estimatedRetrievability>[0],
) {
  try {
    return estimatedRetrievability(schedule);
  } catch {
    return null;
  }
}

export const DEFAULT_TIME_ESTIMATES = {
  newMinutes: NEW_GRAMMAR_MINUTES,
  reviewMinutes: REVIEW_MINUTES,
  needsWorkMinutes: NEEDS_WORK_REVIEW_MINUTES,
};

export function estimateReviewMinutes(
  candidate: { status: string; lastScore: number | null },
  estimates: typeof DEFAULT_TIME_ESTIMATES,
) {
  return candidate.status === 'NEEDS_WORK' || (candidate.lastScore ?? 100) < 60
    ? estimates.needsWorkMinutes
    : estimates.reviewMinutes;
}

export function sampledMedian(
  values: number[],
  minimum: number,
  maximum: number,
  fallback: number,
) {
  if (values.length < 5) return fallback;
  const sorted = [...values].sort((left, right) => left - right).slice(-20);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.max(minimum, Math.min(maximum, Math.round(median)));
}
