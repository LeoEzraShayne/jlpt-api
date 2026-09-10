import { Injectable } from '@nestjs/common';
import { TaskStatus, TaskType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  calculateNewGrammarCount,
  NEEDS_WORK_REVIEW_MINUTES,
  NEW_GRAMMAR_MINUTES,
  REVIEW_MINUTES,
  reviewMinutes,
  selectReviews,
  sortReviewCandidates,
} from './task-planning';
import { buildProgressSummary } from './progress-summary';
import {
  buildLearningTaskStatistics,
  loadDashboardStatistics,
} from './dashboard-statistics';
import { calendarDayDifference } from '../review/adaptive-review';
import {
  DEFAULT_TIME_ESTIMATES,
  estimateReviewMinutes,
  safeRetrievability,
  sampledMedian,
} from './dashboard-estimates';

export function localDate(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const key = `${get('year')}-${get('month')}-${get('day')}`;
  return { key, value: new Date(`${key}T00:00:00.000Z`) };
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getToday(userId: string, timezone: string) {
    const generation = await this.ensureDailyTasks(userId, timezone);
    const legacyGeneration = generation as unknown as
      NonNullable<typeof generation>['plan'] | undefined;
    const plan = generation?.plan ?? legacyGeneration;
    const { key, value: taskDate } = localDate(timezone);
    const tasks = await this.prisma.studyTask.findMany({
      where: {
        userId,
        status: { not: TaskStatus.SKIPPED },
        OR: [
          { taskDate },
          {
            taskDate: { lt: taskDate },
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          },
        ],
        ...(plan ? { grammar: { level: plan.level } } : {}),
      },
      include: {
        grammar: {
          include: {
            progress: {
              where: { userId },
              include: { schedule: true },
              take: 1,
            },
          },
        },
      },
    });
    const requiredReviewRemaining = tasks.filter(
      (task) =>
        task.type === TaskType.REVIEW && task.status !== TaskStatus.COMPLETED,
    ).length;
    const newLearningUnlocked = requiredReviewRemaining === 0;
    const presented = tasks
      .map((task) => {
        const progress = task.grammar?.progress[0];
        const estimatedMinutes =
          task.estimatedMinutes ??
          (task.type === TaskType.LEARN
            ? NEW_GRAMMAR_MINUTES
            : reviewMinutes({
                status: progress?.status ?? 'LEARNING',
                lastScore: progress?.lastScore ?? null,
              }));
        const dueKey = progress?.schedule?.nextReviewOn
          ? progress.schedule.nextReviewOn.toISOString().slice(0, 10)
          : progress?.schedule
            ? localDate(timezone, progress.schedule.nextReviewAt).key
            : task.taskDate.toISOString().slice(0, 10);
        return {
          ...task,
          estimatedMinutes,
          dueOn: task.type === TaskType.REVIEW ? dueKey : null,
          overdueDays:
            task.type === TaskType.REVIEW
              ? Math.max(0, calendarDayDifference(dueKey, key))
              : 0,
          priorityGroup:
            task.type === TaskType.LEARN
              ? ('NEW' as const)
              : dueKey < key
                ? ('OVERDUE' as const)
                : ('DUE_TODAY' as const),
          locked:
            task.type === TaskType.LEARN &&
            task.status !== TaskStatus.COMPLETED &&
            !newLearningUnlocked,
        };
      })
      .sort((left, right) => {
        if (left.type !== right.type)
          return left.type === TaskType.REVIEW ? -1 : 1;
        if (
          left.status === TaskStatus.COMPLETED &&
          right.status !== TaskStatus.COMPLETED
        )
          return 1;
        if (
          right.status === TaskStatus.COMPLETED &&
          left.status !== TaskStatus.COMPLETED
        )
          return -1;
        if (
          left.type === TaskType.REVIEW &&
          right.type === TaskType.REVIEW &&
          left.dueOn !== right.dueOn
        )
          return (left.dueOn ?? '').localeCompare(right.dueOn ?? '');
        if (left.type === TaskType.REVIEW && right.type === TaskType.REVIEW) {
          const leftNeedsWork =
            left.grammar?.progress[0]?.status === 'NEEDS_WORK';
          const rightNeedsWork =
            right.grammar?.progress[0]?.status === 'NEEDS_WORK';
          if (leftNeedsWork !== rightNeedsWork)
            return Number(rightNeedsWork) - Number(leftNeedsWork);
        }
        return left.createdAt.getTime() - right.createdAt.getTime();
      });
    const pending = presented.filter(
      (task) => task.status !== TaskStatus.COMPLETED,
    );
    const learningTaskStatistics = buildLearningTaskStatistics(presented);
    const grouped = {
      newCount: pending.filter((task) => task.type === TaskType.LEARN).length,
      reviewCount: pending.filter((task) => task.type === TaskType.REVIEW)
        .length,
      completedCount: presented.filter(
        (task) => task.status === TaskStatus.COMPLETED,
      ).length,
    };
    const [progressCounts, totalGrammar, statistics] = await Promise.all([
      plan
        ? this.prisma.userGrammarProgress.groupBy({
            by: ['status'],
            where: {
              userId,
              grammar: { level: plan.level, status: 'PUBLISHED' },
            },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      plan
        ? this.prisma.grammarPoint.count({
            where: { level: plan.level, status: 'PUBLISHED' },
          })
        : Promise.resolve(0),
      loadDashboardStatistics(this.prisma, {
        userId,
        timezone,
        todayKey: key,
        level: plan?.level,
        plannedReviews: pending
          .filter((task) => task.type === TaskType.REVIEW)
          .map((task) => ({
            progressId: task.progressId,
            grammarId: task.grammarId,
          })),
      }),
    ]);
    const progressSummary = buildProgressSummary(totalGrammar, progressCounts);
    const nextTask =
      pending.find((task) => task.type === TaskType.REVIEW) ??
      (newLearningUnlocked
        ? pending.find((task) => task.type === TaskType.LEARN)
        : undefined);
    return {
      summary: {
        ...grouped,
        ...learningTaskStatistics,
        overdueReviewCount: statistics.overdueReviewCount,
        dueTodayReviewCount: statistics.dueTodayReviewCount,
        upcomingReviewCount: statistics.upcomingReviewCount,
        completedTodayCount: statistics.completedTodayCount,
        completedTodayReviewCount: statistics.completedTodayReviewCount,
        completedTodayNewCount: statistics.completedTodayNewCount,
        caughtUpOverdueTodayCount: statistics.caughtUpOverdueTodayCount,
        studyMinutesToday: statistics.studyMinutesToday,
        level: plan?.level ?? null,
        totalGrammar,
        ...progressSummary,
      },
      estimatedMinutes: pending.reduce(
        (total, task) => total + task.estimatedMinutes,
        0,
      ),
      planning: {
        budgetMinutes: plan?.dailyMinutes ?? 0,
        plannedMinutes: pending.reduce(
          (total, task) => total + task.estimatedMinutes,
          0,
        ),
        dueUnscheduledCount:
          statistics.overdueUnscheduledCount +
          statistics.dueTodayUnscheduledCount,
        overdueUnscheduledCount: statistics.overdueUnscheduledCount,
        dueTodayUnscheduledCount: statistics.dueTodayUnscheduledCount,
        planAtRisk:
          statistics.overdueUnscheduledCount +
            statistics.dueTodayUnscheduledCount >
          0,
        algorithmVersion: generation?.algorithmVersion ?? 'legacy-v1',
      },
      requiredReviewRemaining,
      newLearningUnlocked,
      nextTaskId: nextTask?.id ?? null,
      tasks: presented,
    };
  }

  async ensureDailyTasks(userId: string, timezone: string) {
    const plan = await this.prisma.studyPlan.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    if (!plan) return;
    const now = new Date();
    const { key, value: taskDate } = localDate(timezone, now);
    const [dueSchedules, existingTasks] = await Promise.all([
      this.prisma.reviewSchedule.findMany({
        where: {
          progress: { userId, grammar: { level: plan.level } },
          OR: [
            { nextReviewOn: { lte: taskDate } },
            { nextReviewOn: null, nextReviewAt: { lte: now } },
          ],
        },
        include: { progress: true },
        orderBy: [{ nextReviewOn: 'asc' }, { nextReviewAt: 'asc' }],
      }),
      this.prisma.studyTask.findMany({
        where: {
          userId,
          status: { not: TaskStatus.SKIPPED },
          grammar: { level: plan.level },
          OR: [
            { taskDate },
            {
              taskDate: { lt: taskDate },
              status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
            },
          ],
        },
        include: {
          studySession: { select: { id: true } },
          grammar: {
            include: { progress: { where: { userId }, take: 1 } },
          },
        },
      }),
    ]);
    const timeEstimates = await this.getTimeEstimates(userId);
    const preserved = existingTasks.filter(
      (task) =>
        task.taskDate < taskDate ||
        task.status !== TaskStatus.PENDING ||
        task.studySession,
    );
    const preservedReview = preserved.filter(
      (task) => task.type === TaskType.REVIEW,
    );
    const preservedNew = preserved.filter(
      (task) => task.type === TaskType.LEARN,
    );
    const preservedReviewIds = new Set(
      preservedReview.map((task) => task.progressId ?? task.grammarId),
    );
    const candidates = dueSchedules
      .filter(
        (item) =>
          !preservedReviewIds.has(item.progressId) &&
          !preservedReviewIds.has(item.progress.grammarId),
      )
      .map((item) => ({
        schedule: item,
        grammarId: item.progress.grammarId,
        nextReviewAt: item.nextReviewAt,
        priorityDay: item.nextReviewOn
          ? item.nextReviewOn.toISOString().slice(0, 10)
          : localDate(timezone, item.nextReviewAt).key,
        status: item.progress.status,
        masteryScore: item.progress.masteryScore,
        lastScore: item.progress.lastScore,
        stability: item.stability,
        estimatedRetrievability: safeRetrievability(item),
      }));
    const preservedReviewMinutes = preservedReview.reduce((total, task) => {
      const item = task.grammar?.progress[0];
      return (
        total +
        estimateReviewMinutes(
          {
            status: item?.status ?? 'LEARNING',
            lastScore: item?.lastScore ?? null,
          },
          timeEstimates,
        )
      );
    }, 0);
    const selectedReview = selectReviews(
      candidates,
      plan.dailyMinutes,
      preservedReviewMinutes,
      (candidate) => estimateReviewMinutes(candidate, timeEstimates),
    );
    const preservedNewMinutes = preservedNew.length * timeEstimates.newMinutes;
    const allDuePlanned = selectedReview.selected.length === candidates.length;
    const newCount = allDuePlanned
      ? calculateNewGrammarCount({
          dailyMinutes: plan.dailyMinutes,
          dailyNewLimit: plan.dailyNewLimit,
          usedMinutes: selectedReview.selectedMinutes + preservedNewMinutes,
          hasDueReviews: dueSchedules.length > 0 || preservedReview.length > 0,
          preservedNewCount: preservedNew.length,
          newGrammarMinutes: timeEstimates.newMinutes,
        })
      : 0;
    const preservedGrammarIds = new Set(
      preserved.map((task) => task.grammarId).filter(Boolean),
    );
    const newGrammar = newCount
      ? await this.prisma.grammarPoint.findMany({
          where: {
            level: plan.level,
            status: 'PUBLISHED',
            id: { notIn: [...preservedGrammarIds] as string[] },
            progress: { none: { userId } },
          },
          orderBy: { sortOrder: 'asc' },
          take: newCount,
        })
      : [];
    const desiredKeys = new Set([
      ...preserved.map((task) => task.idempotencyKey),
      ...selectedReview.selected.map(
        (item) => `${userId}:${key}:REVIEW:${item.grammarId}`,
      ),
      ...newGrammar.map((grammar) => `${userId}:${key}:LEARN:${grammar.id}`),
    ]);
    await this.prisma.$transaction(async (tx) => {
      for (const task of existingTasks) {
        if (
          task.status === TaskStatus.PENDING &&
          !task.studySession &&
          !desiredKeys.has(task.idempotencyKey)
        )
          await tx.studyTask.delete({ where: { id: task.id } });
      }
      for (const item of sortReviewCandidates(selectedReview.selected))
        await tx.studyTask.upsert({
          where: {
            idempotencyKey: `${userId}:${key}:REVIEW:${item.grammarId}`,
          },
          create: {
            userId,
            planId: plan.id,
            progressId: item.schedule.progressId,
            grammarId: item.grammarId,
            taskDate,
            type: TaskType.REVIEW,
            estimatedMinutes: estimateReviewMinutes(item, timeEstimates),
            idempotencyKey: `${userId}:${key}:REVIEW:${item.grammarId}`,
          },
          update: {
            planId: plan.id,
            progressId: item.schedule.progressId,
            grammarId: item.grammarId,
            taskDate,
            type: TaskType.REVIEW,
            status: TaskStatus.PENDING,
            skipReason: null,
            estimatedMinutes: estimateReviewMinutes(item, timeEstimates),
          },
        });
      for (const grammar of newGrammar)
        await tx.studyTask.upsert({
          where: { idempotencyKey: `${userId}:${key}:LEARN:${grammar.id}` },
          create: {
            userId,
            planId: plan.id,
            grammarId: grammar.id,
            taskDate,
            type: TaskType.LEARN,
            estimatedMinutes: timeEstimates.newMinutes,
            idempotencyKey: `${userId}:${key}:LEARN:${grammar.id}`,
          },
          update: {
            planId: plan.id,
            progressId: null,
            grammarId: grammar.id,
            taskDate,
            type: TaskType.LEARN,
            status: TaskStatus.PENDING,
            skipReason: null,
            estimatedMinutes: timeEstimates.newMinutes,
          },
        });
    });
    return {
      plan,
      dueUnscheduledCount: Math.max(
        0,
        candidates.length - selectedReview.selected.length,
      ),
      algorithmVersion:
        dueSchedules.find((item) => item.algorithmVersion !== 'legacy-v1')
          ?.algorithmVersion ?? 'legacy-v1',
    };
  }

  private async getTimeEstimates(userId: string) {
    if (!this.prisma.studySession?.findMany) return DEFAULT_TIME_ESTIMATES;
    const sessions = await this.prisma.studySession.findMany({
      where: {
        userId,
        status: 'COMPLETED',
        activeSeconds: { gt: 0 },
      },
      select: {
        mode: true,
        activeSeconds: true,
        reviewEvent: { select: { effectiveRating: true } },
      },
      orderBy: { completedAt: 'desc' },
      take: 40,
    });
    const learning = sessions
      .filter((session) => session.mode === 'LEARN')
      .map((session) => session.activeSeconds / 60);
    const normalReviews = sessions
      .filter(
        (session) =>
          session.mode !== 'LEARN' &&
          session.reviewEvent?.effectiveRating === 'REMEMBERED',
      )
      .map((session) => session.activeSeconds / 60);
    const weakReviews = sessions
      .filter(
        (session) =>
          session.mode !== 'LEARN' &&
          session.reviewEvent?.effectiveRating !== 'REMEMBERED',
      )
      .map((session) => session.activeSeconds / 60);
    return {
      newMinutes: sampledMedian(learning, 4, 20, NEW_GRAMMAR_MINUTES),
      reviewMinutes: sampledMedian(normalReviews, 2, 15, REVIEW_MINUTES),
      needsWorkMinutes: sampledMedian(
        weakReviews,
        2,
        15,
        NEEDS_WORK_REVIEW_MINUTES,
      ),
    };
  }
}
