import { ProgressStatus, RecallRating } from '@prisma/client';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  addCalendarDays,
  calculateAdaptiveReview,
  calendarDayDifference,
  localDateKey,
  type StoredReviewState,
} from '../review/adaptive-review';
import { calculateReview } from '../review/review-algorithm';
import {
  NEEDS_WORK_REVIEW_MINUTES,
  NEW_GRAMMAR_MINUTES,
  REVIEW_MINUTES,
} from '../dashboard/task-planning';

export const LEGACY_ALGORITHM_VERSION = 'legacy-v1';
export type ForecastAlgorithmVersion =
  typeof LEGACY_ALGORITHM_VERSION | typeof ADAPTIVE_ALGORITHM_VERSION;

interface ForecastItem {
  id: string;
  status: ProgressStatus;
  stage: number;
  masteryScore: number;
  schedule: StoredReviewState;
}

export function buildStudyPlanForecast({
  timezone,
  dailyNewLimit,
  targetDate,
  horizonDays,
  remainingNew,
  items,
  algorithmVersion,
  now = new Date(),
}: {
  timezone: string;
  dailyMinutes: number;
  dailyNewLimit: number;
  targetDate: Date;
  horizonDays: number;
  remainingNew: number;
  items: ForecastItem[];
  algorithmVersion: ForecastAlgorithmVersion;
  now?: Date;
}) {
  const today = localDateKey(timezone, now);
  const targetKey = targetDate.toISOString().slice(0, 10);
  const targetDays = Math.max(1, calendarDayDifference(today, targetKey) + 1);
  const simulationDays = Math.min(365, Math.max(horizonDays, targetDays));
  const states = items.map((item) => ({ ...item }));
  const days = [];
  let newRemaining = remainingNew;
  let projectedCompletionDate: string | null = newRemaining ? null : today;
  let anyOverload = false;
  let remainingNewAfterHorizon = newRemaining;

  for (let offset = 0; offset < simulationDays; offset += 1) {
    const date = addCalendarDays(today, offset);
    const reviewAt = new Date(`${date}T12:00:00.000Z`);
    const due = states
      .filter((item) => dueKey(item.schedule, timezone) <= date)
      .sort((left, right) =>
        dueKey(left.schedule, timezone).localeCompare(
          dueKey(right.schedule, timezone),
        ),
      );
    let plannedMinutes = 0;
    const selected: ForecastItem[] = [];
    for (const item of due) {
      const minutes =
        item.status === ProgressStatus.NEEDS_WORK
          ? NEEDS_WORK_REVIEW_MINUTES
          : REVIEW_MINUTES;
      selected.push(item);
      plannedMinutes += minutes;
    }
    for (const item of selected)
      applyRememberedReview(item, algorithmVersion, reviewAt, timezone);

    const dueUnscheduledCount = due.length - selected.length;
    const newCount = Math.min(newRemaining, dailyNewLimit);
    for (let index = 0; index < newCount; index += 1) {
      const item = newForecastItem(offset, index, reviewAt, timezone);
      applyRememberedReview(item, algorithmVersion, reviewAt, timezone, true);
      states.push(item);
    }
    newRemaining -= newCount;
    if (newRemaining === 0 && !projectedCompletionDate)
      projectedCompletionDate = date;
    plannedMinutes += newCount * NEW_GRAMMAR_MINUTES;
    const overloaded = dueUnscheduledCount > 0;
    if (date <= targetKey) anyOverload ||= overloaded;
    if (offset === horizonDays - 1) remainingNewAfterHorizon = newRemaining;
    if (offset < horizonDays)
      days.push({
        date,
        reviewCount: selected.length,
        newCount,
        estimatedMinutes: plannedMinutes,
        capacityMinutes: 0,
        timeLimited: false,
        dueUnscheduledCount,
        overloaded,
      });
  }
  return {
    days,
    meta: {
      algorithmVersion,
      isEstimate: true,
      assumption: 'REMEMBERED' as const,
      projectedCompletionDate,
      targetDate: targetKey,
      remainingNewAfterHorizon,
      planAtRisk:
        anyOverload ||
        !projectedCompletionDate ||
        projectedCompletionDate > targetKey,
    },
  };
}

function applyRememberedReview(
  item: ForecastItem,
  algorithmVersion: ForecastAlgorithmVersion,
  reviewAt: Date,
  timezone: string,
  isInitial = false,
) {
  if (algorithmVersion === ADAPTIVE_ALGORITHM_VERSION) {
    const outcome = calculateAdaptiveReview({
      schedule: isInitial ? undefined : item.schedule,
      rating: RecallRating.REMEMBERED,
      now: reviewAt,
      timezone,
    });
    item.schedule = {
      nextReviewAt: outcome.nextReviewAt,
      nextReviewOn: outcome.nextReviewOn,
      lastReviewAt: reviewAt,
      stability: outcome.stabilityAfter,
      difficulty: outcome.difficultyAfter,
      fsrsState: outcome.fsrsState,
      scheduledDays: outcome.intervalDays,
      elapsedDays: outcome.elapsedDays,
      reps: outcome.reps,
      lapses: outcome.lapses,
      stateSource: outcome.stateSource,
    };
  } else {
    const outcome = calculateReview({
      stage: item.stage,
      masteryScore: item.masteryScore,
      rating: RecallRating.REMEMBERED,
      isInitial,
      now: reviewAt,
    });
    const nextKey = localDateKey(timezone, outcome.nextReviewAt);
    item.stage = outcome.stage;
    item.masteryScore = outcome.masteryScore;
    item.schedule = {
      ...item.schedule,
      nextReviewAt: new Date(`${nextKey}T00:00:00.000Z`),
      nextReviewOn: new Date(`${nextKey}T00:00:00.000Z`),
      lastReviewAt: reviewAt,
      scheduledDays: calendarDayDifference(
        localDateKey(timezone, reviewAt),
        nextKey,
      ),
      reps: item.schedule.reps + 1,
    };
  }
  item.status = ProgressStatus.LEARNING;
}

function newForecastItem(
  offset: number,
  index: number,
  reviewAt: Date,
  timezone: string,
): ForecastItem {
  const today = localDateKey(timezone, reviewAt);
  return {
    id: `forecast-new-${offset}-${index}`,
    status: ProgressStatus.NOT_STARTED,
    stage: 0,
    masteryScore: 0,
    schedule: {
      nextReviewAt: new Date(`${today}T00:00:00.000Z`),
      nextReviewOn: new Date(`${today}T00:00:00.000Z`),
      lastReviewAt: null,
      stability: null,
      difficulty: null,
      fsrsState: null,
      scheduledDays: null,
      elapsedDays: null,
      reps: 0,
      lapses: 0,
      stateSource: null,
    },
  };
}

function dueKey(schedule: StoredReviewState, timezone: string) {
  return schedule.nextReviewOn
    ? schedule.nextReviewOn.toISOString().slice(0, 10)
    : localDateKey(timezone, schedule.nextReviewAt);
}
