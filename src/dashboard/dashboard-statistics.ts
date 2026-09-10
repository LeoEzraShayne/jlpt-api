import {
  JlptLevel,
  Prisma,
  SessionMode,
  SessionStatus,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

type PlannedReview = {
  progressId: string | null;
  grammarId: string | null;
};

type DashboardSchedule = {
  progressId: string;
  nextReviewOn: Date | null;
  nextReviewAt: Date;
  progress: { grammarId: string };
};

type StatisticsInput = {
  userId: string;
  timezone: string;
  todayKey: string;
  level?: JlptLevel;
  levels?: JlptLevel[];
  plannedReviews: PlannedReview[];
};

export async function loadDashboardStatistics(
  prisma: PrismaService,
  input: StatisticsInput,
) {
  const { start, end } = localDayUtcRange(input.todayKey, input.timezone);
  const reviewCompletionWhere: Prisma.ReviewEventWhereInput = {
    userId: input.userId,
    reviewedAt: { gte: start, lt: end },
    affectsSchedule: true,
    OR: [
      { task: { is: { type: TaskType.REVIEW } } },
      { taskId: null, session: { mode: SessionMode.REVIEW } },
    ],
  };
  const schedulesPromise: Promise<DashboardSchedule[]> =
    input.level || input.levels
      ? prisma.reviewSchedule.findMany({
          where: {
            progress: {
              userId: input.userId,
              grammar: {
                is: {
                  level: input.levels ? { in: input.levels } : input.level,
                  status: 'PUBLISHED',
                },
              },
            },
          },
          select: {
            progressId: true,
            nextReviewOn: true,
            nextReviewAt: true,
            progress: { select: { grammarId: true } },
          },
        })
      : Promise.resolve([]);
  const [
    schedules,
    completedTodayNewCount,
    completedTodayReviewCount,
    caughtUpOverdueTodayCount,
    activeTime,
  ] = await Promise.all([
    schedulesPromise,
    prisma.studyTask.count({
      where: {
        userId: input.userId,
        status: TaskStatus.COMPLETED,
        type: TaskType.LEARN,
        completedAt: { gte: start, lt: end },
      },
    }),
    prisma.reviewEvent.count({ where: reviewCompletionWhere }),
    prisma.reviewEvent.count({
      where: {
        ...reviewCompletionWhere,
        scheduledFor: { lt: new Date(`${input.todayKey}T00:00:00.000Z`) },
      },
    }),
    prisma.studySession.aggregate({
      where: {
        userId: input.userId,
        status: SessionStatus.COMPLETED,
        completedAt: { gte: start, lt: end },
      },
      _sum: { activeSeconds: true },
    }),
  ]);
  const backlog = schedules
    .map((schedule) => ({
      ...schedule,
      dueKey: schedule.nextReviewOn
        ? schedule.nextReviewOn.toISOString().slice(0, 10)
        : localDateKey(input.timezone, schedule.nextReviewAt),
    }))
    .filter((schedule) => schedule.dueKey <= input.todayKey);
  const overdue = backlog.filter(
    (schedule) => schedule.dueKey < input.todayKey,
  );
  const dueToday = backlog.filter(
    (schedule) => schedule.dueKey === input.todayKey,
  );
  const upcomingUpperKey = addDays(input.todayKey, 7);
  const upcomingReviewCount = schedules.filter((schedule) => {
    const dueKey = schedule.nextReviewOn
      ? schedule.nextReviewOn.toISOString().slice(0, 10)
      : localDateKey(input.timezone, schedule.nextReviewAt);
    return dueKey > input.todayKey && dueKey <= upcomingUpperKey;
  }).length;
  const plannedIds = new Set(
    input.plannedReviews.flatMap((task) =>
      [task.progressId, task.grammarId].filter((value): value is string =>
        Boolean(value),
      ),
    ),
  );
  const isPlanned = (schedule: (typeof backlog)[number]) =>
    plannedIds.has(schedule.progressId) ||
    plannedIds.has(schedule.progress.grammarId);
  return {
    overdueReviewCount: overdue.length,
    dueTodayReviewCount: dueToday.length,
    overdueUnscheduledCount: overdue.filter((item) => !isPlanned(item)).length,
    dueTodayUnscheduledCount: dueToday.filter((item) => !isPlanned(item))
      .length,
    upcomingReviewCount,
    completedTodayCount: completedTodayReviewCount + completedTodayNewCount,
    completedTodayReviewCount,
    completedTodayNewCount,
    caughtUpOverdueTodayCount,
    studyMinutesToday: Math.ceil((activeTime._sum.activeSeconds ?? 0) / 60),
  };
}

export function buildLearningTaskStatistics(
  tasks: Array<{ type: TaskType; status: TaskStatus }>,
) {
  const pendingReviewCount = tasks.filter(
    (task) =>
      task.type === TaskType.REVIEW && task.status === TaskStatus.PENDING,
  ).length;
  const inProgressReviewCount = tasks.filter(
    (task) =>
      task.type === TaskType.REVIEW && task.status === TaskStatus.IN_PROGRESS,
  ).length;
  return {
    pendingNewCount: tasks.filter(
      (task) =>
        task.type === TaskType.LEARN && task.status === TaskStatus.PENDING,
    ).length,
    inProgressNewCount: tasks.filter(
      (task) =>
        task.type === TaskType.LEARN && task.status === TaskStatus.IN_PROGRESS,
    ).length,
    pendingReviewCount,
    inProgressReviewCount,
    plannedReviewRemainingCount: pendingReviewCount + inProgressReviewCount,
  };
}

export function localDayUtcRange(key: string, timezone: string) {
  return {
    start: zonedMidnight(key, timezone),
    end: zonedMidnight(addDay(key), timezone),
  };
}

function zonedMidnight(key: string, timezone: string) {
  const [year, month, day] = key.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = localParts(timezone, new Date(candidate));
    const represented = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const adjustment = target - represented;
    if (adjustment === 0) break;
    candidate += adjustment;
  }
  return new Date(candidate);
}

function localDateKey(timezone: string, date: Date) {
  const parts = localParts(timezone, date);
  return [parts.year, parts.month, parts.day]
    .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0'))
    .join('-');
}

function localParts(timezone: string, date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function addDay(key: string) {
  return addDays(key, 1);
}

function addDays(key: string, days: number) {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
