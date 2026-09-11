import { Injectable } from '@nestjs/common';
import { TaskStatus, TaskType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { NEW_GRAMMAR_MINUTES, reviewMinutes } from './task-planning';
import { generateDailyTasks } from './daily-task-generation';
import { budgetGroup } from './daily-allocation';
import { buildProgressSummary } from './progress-summary';
import {
  buildLearningTaskStatistics,
  loadDashboardStatistics,
} from './dashboard-statistics';
import { calendarDayDifference } from '../review/adaptive-review';

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
    const plan = generation.plan;
    const primaryLevel = generation.user.targetLevel;
    const { key } = localDate(timezone);
    const tasks = await this.prisma.studyTask.findMany({
      where: {
        userId,
        id: { in: generation.scheduledIds },
        status: { not: TaskStatus.SKIPPED },
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
    const enabledIds = new Set(generation.plans.map((item) => item.id));
    const requiredReviewRemaining = tasks.filter(
      (task) =>
        task.type === TaskType.REVIEW &&
        task.status !== TaskStatus.COMPLETED &&
        enabledIds.has(task.planId ?? ''),
    ).length;
    const pendingReviewsByGroup = { PRIMARY: 0, FOUNDATION: 0 };
    for (const task of tasks) {
      if (
        task.type === TaskType.REVIEW &&
        task.status !== TaskStatus.COMPLETED &&
        enabledIds.has(task.planId ?? '')
      )
        pendingReviewsByGroup[budgetGroup(task.grammar?.level, primaryLevel)] +=
          1;
    }
    const newLearningUnlocked = pendingReviewsByGroup.PRIMARY === 0;
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
          group: budgetGroup(task.grammar?.level, primaryLevel),
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
            pendingReviewsByGroup[
              budgetGroup(task.grammar?.level, primaryLevel)
            ] > 0,
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
        levels: generation.plans.map((item) => item.level),
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
      pending.find((task) => task.type === TaskType.LEARN && !task.locked);
    const levels = await Promise.all(
      generation.plans.map(async (item) => {
        const [counts, total] = await Promise.all([
          this.prisma.userGrammarProgress.groupBy({
            by: ['status'],
            where: {
              userId,
              grammar: { level: item.level, status: 'PUBLISHED' },
            },
            _count: { _all: true },
          }),
          this.prisma.grammarPoint.count({
            where: { level: item.level, status: 'PUBLISHED' },
          }),
        ]);
        const levelTasks = presented.filter(
          (task) => task.grammar?.level === item.level,
        );
        return {
          planId: item.id,
          level: item.level,
          mode: item.mode,
          isPrimary: item.level === primaryLevel,
          ...buildProgressSummary(total, counts),
          totalGrammar: total,
          newCount: levelTasks.filter(
            (task) =>
              task.type === TaskType.LEARN &&
              task.status !== TaskStatus.COMPLETED,
          ).length,
          reviewCount: levelTasks.filter(
            (task) =>
              task.type === TaskType.REVIEW &&
              task.status !== TaskStatus.COMPLETED,
          ).length,
          completedCount: levelTasks.filter(
            (task) => task.status === TaskStatus.COMPLETED,
          ).length,
          estimatedMinutes: levelTasks
            .filter((task) => task.status !== TaskStatus.COMPLETED)
            .reduce((sum, task) => sum + task.estimatedMinutes, 0),
        };
      }),
    );
    return {
      levels,
      allocation: generation.allocation,
      backlog: generation.backlog,
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
        studyMinutesToday: Math.ceil(generation.allocation.spentMinutes),
        level: plan?.level ?? null,
        totalGrammar,
        ...progressSummary,
      },
      estimatedMinutes: pending.reduce(
        (total, task) => total + task.estimatedMinutes,
        0,
      ),
      planning: {
        // Compatibility field; time no longer limits scheduling.
        budgetMinutes: 0,
        timeLimited: false,
        plannedMinutes: pending.reduce(
          (total, task) => total + task.estimatedMinutes,
          0,
        ),
        dueUnscheduledCount: generation.backlog.count,
        overdueUnscheduledCount: statistics.overdueUnscheduledCount,
        dueTodayUnscheduledCount: statistics.dueTodayUnscheduledCount,
        planAtRisk: generation.backlog.count > 0,
        algorithmVersion: generation?.algorithmVersion ?? 'legacy-v1',
      },
      requiredReviewRemaining,
      newLearningUnlocked,
      nextTaskId: nextTask?.id ?? null,
      tasks: presented,
    };
  }

  async ensureDailyTasks(userId: string, timezone: string) {
    return generateDailyTasks(this.prisma, userId, timezone);
  }
}
