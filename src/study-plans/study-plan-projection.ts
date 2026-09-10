import {
  GrammarPoint,
  ReviewSchedule,
  StudyPlan,
  UserGrammarProgress,
  JlptLevel,
} from '@prisma/client';
import { localDayUtcRange } from '../dashboard/dashboard-statistics';
import {
  allocateDailyBudget,
  budgetGroup,
} from '../dashboard/daily-allocation';
import {
  NEW_GRAMMAR_MINUTES,
  reviewMinutes,
  sortReviewCandidates,
} from '../dashboard/task-planning';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  addCalendarDays,
  calendarDayDifference,
  calculateAdaptiveReview,
  localDateKey,
  StoredReviewState,
} from '../review/adaptive-review';

interface ProjectionItem {
  grammarId: string;
  planId: string;
  level: JlptLevel;
  status: string;
  masteryScore: number;
  lastScore: number | null;
  schedule: StoredReviewState | null;
}

export function forecastPlans(input: {
  user: { dailyMinutes: number; primaryShare: number; targetLevel: JlptLevel };
  selected: StudyPlan;
  plans: StudyPlan[];
  progress: (UserGrammarProgress & {
    grammar: GrammarPoint;
    schedule: ReviewSchedule | null;
  })[];
  totals: { level: JlptLevel; _count: { _all: number } }[];
  timezone: string;
  horizonDays: number;
  now?: Date;
  usedNewToday?: Record<string, number>;
  spentToday?: { PRIMARY: number; FOUNDATION: number };
}) {
  const { user, selected, plans, timezone, horizonDays } = input;
  const today = localDateKey(timezone, input.now);
  const targetKey = selected.targetDate.toISOString().slice(0, 10);
  const states: ProjectionItem[] = [];
  const remaining = new Map<string, number>();
  const planByLevel = new Map(plans.map((plan) => [plan.level, plan]));
  for (const progress of input.progress) {
    const plan = planByLevel.get(progress.grammar.level);
    if (!plan || progress.grammar.status !== 'PUBLISHED') continue;
    if (!progress.schedule && !progress.needsWork) continue;
    states.push({
      grammarId: progress.grammarId,
      planId: plan.id,
      level: plan.level,
      status: progress.status,
      masteryScore: progress.masteryScore,
      lastScore: progress.lastScore,
      schedule: progress.schedule,
    });
  }
  for (const plan of plans) {
    const total =
      input.totals.find((item) => item.level === plan.level)?._count._all ?? 0;
    const alreadyTracked = input.progress.filter(
      (item) =>
        item.grammar.level === plan.level &&
        item.grammar.status === 'PUBLISHED' &&
        (item.status !== 'NOT_STARTED' || item.needsWork),
    ).length;
    remaining.set(
      plan.id,
      plan.mode === 'SYSTEM' ? Math.max(0, total - alreadyTracked) : 0,
    );
  }
  const initialRemaining = remaining.get(selected.id) ?? 0;
  let projectedCompletionDate: string | null =
    initialRemaining === 0 &&
    selected.status === 'ACTIVE' &&
    selected.startDate.toISOString().slice(0, 10) <= today
      ? today
      : null;
  let remainingNewAfterHorizon = initialRemaining;
  let atRisk = selected.status !== 'ACTIVE';
  const days = [];
  const simulationDays = Math.min(
    365,
    Math.max(horizonDays, calendarDayDifference(today, targetKey) + 1),
  );
  for (let offset = 0; offset < simulationDays; offset += 1) {
    const date = addCalendarDays(today, offset);
    const active = plans.filter(
      (plan) => plan.startDate.toISOString().slice(0, 10) <= date,
    );
    const activeIds = new Set(active.map((plan) => plan.id));
    const due = sortReviewCandidates(
      states
        .filter(
          (item) =>
            activeIds.has(item.planId) &&
            (!item.schedule || dueKey(item.schedule, timezone) <= date),
        )
        .map((item) => ({
          ...item,
          item,
          nextReviewAt:
            item.schedule?.nextReviewAt ?? new Date(`${date}T00:00:00.000Z`),
          priorityDay: item.schedule ? dueKey(item.schedule, timezone) : date,
        })),
    );
    const candidates: Array<{
      id: string;
      grammarId: string;
      planId: string;
      group: 'PRIMARY' | 'FOUNDATION';
      type: 'REVIEW' | 'LEARN';
      minutes: number;
    }> = due.map((item) => ({
      id: `REVIEW:${item.grammarId}`,
      grammarId: item.grammarId,
      planId: item.planId,
      group: budgetGroup(item.level, user.targetLevel),
      type: 'REVIEW',
      minutes: item.schedule ? reviewMinutes(item) : 6,
    }));
    for (const plan of active) {
      const newCount = Math.min(
        Math.max(
          0,
          plan.dailyNewLimit -
            (offset === 0 ? (input.usedNewToday?.[plan.id] ?? 0) : 0),
        ),
        remaining.get(plan.id) ?? 0,
      );
      for (let index = 0; index < newCount; index += 1)
        candidates.push({
          id: `LEARN:${plan.id}:${offset}:${index}`,
          grammarId: `new:${plan.id}:${offset}:${index}`,
          planId: plan.id,
          group: budgetGroup(plan.level, user.targetLevel),
          type: 'LEARN',
          minutes: NEW_GRAMMAR_MINUTES,
        });
    }
    const allocated = allocateDailyBudget({
      ...user,
      spent:
        offset === 0 && input.spentToday
          ? input.spentToday
          : { PRIMARY: 0, FOUNDATION: 0 },
      candidates,
    });
    for (const task of allocated.selected) {
      const plan = active.find((item) => item.id === task.planId)!;
      let item = states.find((state) => state.grammarId === task.grammarId);
      if (!item) {
        item = {
          grammarId: task.grammarId,
          planId: plan.id,
          level: plan.level,
          status: 'NOT_STARTED',
          masteryScore: 0,
          lastScore: null,
          schedule: null,
        };
        states.push(item);
        remaining.set(plan.id, (remaining.get(plan.id) ?? 0) - 1);
      }
      // The exact production FSRS implementation is reused; this remains a remembered-outcome estimate.
      const reviewAt = new Date(
        localDayUtcRange(date, timezone).start.getTime() + 12 * 60 * 60 * 1000,
      );
      const outcome = calculateAdaptiveReview({
        schedule: item.schedule ?? undefined,
        rating: 'REMEMBERED',
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
      item.status = 'LEARNING';
    }
    const own = allocated.selected.filter(
      (task) => task.planId === selected.id,
    );
    const dueUnscheduledCount =
      due.filter((item) => item.planId === selected.id).length -
      own.filter((task) => task.type === 'REVIEW').length;
    const estimatedMinutes = own.reduce((sum, task) => sum + task.minutes, 0);
    if (
      remaining.get(selected.id) === 0 &&
      !projectedCompletionDate &&
      activeIds.has(selected.id)
    )
      projectedCompletionDate = date;
    if (date <= targetKey && dueUnscheduledCount > 0) atRisk = true;
    if (offset === horizonDays - 1)
      remainingNewAfterHorizon = remaining.get(selected.id) ?? initialRemaining;
    if (offset < horizonDays)
      days.push({
        date,
        reviewCount: own.filter((task) => task.type === 'REVIEW').length,
        newCount: own.filter((task) => task.type === 'LEARN').length,
        estimatedMinutes,
        capacityMinutes: user.dailyMinutes,
        dueUnscheduledCount,
        overloaded: dueUnscheduledCount > 0,
        sharedBudgetMinutes: user.dailyMinutes,
      });
  }
  return {
    days,
    meta: {
      algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
      isEstimate: true,
      assumption: 'REMEMBERED' as const,
      projectedCompletionDate,
      targetDate: targetKey,
      remainingNewAfterHorizon,
      planAtRisk:
        atRisk ||
        !projectedCompletionDate ||
        projectedCompletionDate > targetKey,
      scope: 'SHARED_BUDGET' as const,
      planId: selected.id,
    },
  };
}

function dueKey(schedule: StoredReviewState, timezone: string) {
  return (
    schedule.nextReviewOn?.toISOString().slice(0, 10) ??
    localDateKey(timezone, schedule.nextReviewAt)
  );
}
