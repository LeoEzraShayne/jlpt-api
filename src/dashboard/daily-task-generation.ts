import { nextCalendarDate } from '../study-plans/study-plan-dates';
import { StudyPlan } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  localDateKey,
} from '../review/adaptive-review';
import {
  allocateDailyBudget,
  budgetGroup,
  type AllocationCandidate,
} from './daily-allocation';
import { localDayUtcRange } from './dashboard-statistics';
import {
  NEW_GRAMMAR_MINUTES,
  reviewMinutes,
  sortReviewCandidates,
} from './task-planning';
import { loadDailyBudget } from './daily-budget';
import { safeRetrievability } from './dashboard-estimates';

interface Candidate extends AllocationCandidate {
  grammarId: string;
  progressId: string | null;
}

/** User row locking makes refreshes, plan edits and concurrent devices deterministic. */
export async function generateDailyTasks(
  prisma: PrismaService,
  userId: string,
  timezone: string,
) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const now = new Date();
      const key = localDateKey(timezone, now);
      const taskDate = new Date(`${key}T00:00:00.000Z`);
      const { start, end } = localDayUtcRange(key, timezone);
      const [plans, existing, budget] = await Promise.all([
        tx.studyPlan.findMany({
          where: {
            userId,
            status: 'ACTIVE',
            startDate: { lt: nextCalendarDate(taskDate) },
          },
          orderBy: { level: 'asc' },
        }),
        tx.studyTask.findMany({
          where: {
            userId,
            status: { not: 'SKIPPED' },
            OR: [
              { taskDate },
              { completedAt: { gte: start, lt: end } },
              {
                status: { in: ['PENDING', 'IN_PROGRESS'] },
              },
            ],
          },
          include: { studySession: true, grammar: true },
        }),
        loadDailyBudget(tx, userId, timezone, key, user.targetLevel),
      ]);
      const planByLevel = new Map(plans.map((plan) => [plan.level, plan]));
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const { actual, reserved } = budget;
      // A legacy in-progress task without a session still owns its original reservation.
      for (const task of existing.filter(
        (item) => item.status === 'IN_PROGRESS' && !item.studySession,
      )) {
        reserved[budgetGroup(task.grammar?.level, user.targetLevel)] +=
          task.estimatedMinutes ?? (task.type === 'LEARN' ? 8 : 4);
      }
      const preserved = existing.filter(
        (task) => task.status !== 'PENDING' || task.studySession,
      );
      const preservedIds = new Set(preserved.map((task) => task.grammarId));
      const levels = plans.map((plan) => plan.level);
      const [due, checks] = await Promise.all([
        tx.reviewSchedule.findMany({
          where: {
            progress: {
              userId,
              grammar: { level: { in: levels }, status: 'PUBLISHED' },
            },
            OR: [
              { nextReviewOn: { lte: taskDate } },
              { nextReviewOn: null, nextReviewAt: { lte: now } },
            ],
          },
          include: { progress: { include: { grammar: true } } },
        }),
        tx.userGrammarProgress.findMany({
          where: {
            userId,
            needsWork: true,
            schedule: null,
            grammar: { level: { in: levels }, status: 'PUBLISHED' },
          },
          include: { grammar: true },
          orderBy: { updatedAt: 'asc' },
        }),
      ]);
      const reviews = sortReviewCandidates(
        due.map((schedule) => ({
          schedule,
          grammarId: schedule.progress.grammarId,
          nextReviewAt: schedule.nextReviewAt,
          priorityDay:
            schedule.nextReviewOn?.toISOString().slice(0, 10) ??
            localDateKey(timezone, schedule.nextReviewAt),
          status: schedule.progress.status,
          masteryScore: schedule.progress.masteryScore,
          lastScore: schedule.progress.lastScore,
          stability: schedule.stability,
          estimatedRetrievability: safeRetrievability(schedule),
        })),
      );
      const candidates: Candidate[] = [];
      for (const review of reviews) {
        if (preservedIds.has(review.grammarId)) continue;
        const plan = planByLevel.get(review.schedule.progress.grammar.level)!;
        candidates.push({
          id: `REVIEW:${review.grammarId}`,
          grammarId: review.grammarId,
          progressId: review.schedule.progressId,
          planId: plan.id,
          type: 'REVIEW',
          group: budgetGroup(plan.level, user.targetLevel),
          minutes: reviewMinutes(review),
        });
      }
      for (const check of checks) {
        if (preservedIds.has(check.grammarId)) continue;
        const plan = planByLevel.get(check.grammar.level)!;
        candidates.push({
          id: `REVIEW:${check.grammarId}`,
          grammarId: check.grammarId,
          progressId: check.id,
          planId: plan.id,
          type: 'REVIEW',
          group: budgetGroup(plan.level, user.targetLevel),
          minutes: 6,
        });
      }
      for (const plan of plans) {
        if (plan.mode !== 'SYSTEM') continue;
        const usedNew = preserved.filter(
          (task) => task.type === 'LEARN' && task.grammar?.level === plan.level,
        ).length;
        const take = Math.max(0, plan.dailyNewLimit - usedNew);
        if (!take) continue;
        const grammar = await tx.grammarPoint.findMany({
          where: {
            level: plan.level,
            status: 'PUBLISHED',
            id: { notIn: [...preservedIds].filter((id): id is string => !!id) },
            AND: [
              {
                progress: { none: { userId, status: { not: 'NOT_STARTED' } } },
              },
              { progress: { none: { userId, needsWork: true } } },
            ],
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          take,
        });
        for (const item of grammar)
          candidates.push({
            id: `LEARN:${item.id}`,
            grammarId: item.id,
            progressId: null,
            planId: plan.id,
            type: 'LEARN',
            group: budgetGroup(plan.level, user.targetLevel),
            minutes: NEW_GRAMMAR_MINUTES,
          });
      }
      const allocated = allocateDailyBudget({
        dailyMinutes: user.dailyMinutes,
        primaryShare: user.primaryShare,
        spent: {
          PRIMARY: actual.PRIMARY + reserved.PRIMARY,
          FOUNDATION: actual.FOUNDATION + reserved.FOUNDATION,
        },
        candidates,
      });
      const selected = new Map(
        allocated.selected.map((item) => [item.id, item]),
      );
      // ReviewSchedule is the backlog; only unstarted task rows may be discarded.
      // Selected open reviews are reused, including legacy rows from earlier days.
      for (const task of existing) {
        if (task.status !== 'PENDING' || task.studySession) continue;
        const candidate = selected.get(`${task.type}:${task.grammarId}`);
        if (!candidate) await tx.studyTask.delete({ where: { id: task.id } });
      }
      const scheduledIds: string[] = [];
      for (const candidate of allocated.selected) {
        const reusable = existing.find(
          (task) =>
            task.grammarId === candidate.grammarId &&
            task.type === candidate.type &&
            task.status === 'PENDING' &&
            !task.studySession,
        );
        const data = {
          planId: candidate.planId,
          progressId: candidate.progressId,
          grammarId: candidate.grammarId,
          taskDate,
          estimatedMinutes: candidate.minutes,
        };
        const task = reusable
          ? await tx.studyTask.update({ where: { id: reusable.id }, data })
          : await tx.studyTask.upsert({
              where: { idempotencyKey: `${userId}:${key}:${candidate.id}` },
              create: {
                ...data,
                userId,
                type: candidate.type,
                idempotencyKey: `${userId}:${key}:${candidate.id}`,
              },
              update: { ...data, status: 'PENDING', skipReason: null },
            });
        scheduledIds.push(task.id);
      }
      for (const task of preserved) {
        if (
          task.status !== 'COMPLETED' &&
          planById.has(task.planId ?? '') &&
          (task.status === 'IN_PROGRESS' ||
            task.studySession?.status === 'ACTIVE')
        ) {
          await tx.studyTask.update({
            where: { id: task.id },
            data: { taskDate },
          });
        }
        if (
          task.status === 'COMPLETED' ||
          task.status === 'IN_PROGRESS' ||
          (task.studySession?.status === 'ACTIVE' &&
            planById.has(task.planId ?? ''))
        )
          scheduledIds.push(task.id);
      }
      const pendingReviews = new Set([
        ...allocated.selected
          .filter((item) => item.type === 'REVIEW')
          .map((item) => item.grammarId),
        ...preserved
          .filter(
            (item) => item.type === 'REVIEW' && item.status !== 'COMPLETED',
          )
          .map((item) => item.grammarId),
      ]);
      const backlog = due.filter(
        (item) =>
          !pendingReviews.has(item.progress.grammarId) &&
          !preservedIds.has(item.progress.grammarId),
      );
      return {
        user,
        plans,
        plan: plans.find((plan) => plan.level === user.targetLevel),
        scheduledIds,
        allocation: {
          ...allocated.allocation,
          spentMinutes: actual.PRIMARY + actual.FOUNDATION,
          reservedMinutes: reserved.PRIMARY + reserved.FOUNDATION,
          overrunMinutes: Math.max(
            0,
            actual.PRIMARY + actual.FOUNDATION - user.dailyMinutes,
          ),
        },
        backlog: {
          count:
            backlog.length +
            checks.filter(
              (item) =>
                !pendingReviews.has(item.grammarId) &&
                !preservedIds.has(item.grammarId),
            ).length,
          overdueCount: backlog.filter(
            (item) =>
              (item.nextReviewOn?.toISOString().slice(0, 10) ??
                localDateKey(timezone, item.nextReviewAt)) < key,
          ).length,
        },
        algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
      };
    },
    { timeout: 15000 },
  );
}

export type DailyGeneration = Awaited<ReturnType<typeof generateDailyTasks>>;
export type EnabledPlan = Pick<StudyPlan, 'id' | 'level' | 'mode' | 'status'>;
