import { ProgressStatus, TaskStatus, TaskType } from '@prisma/client';
import { DashboardService, localDate } from './dashboard.service';

describe('DashboardService daily task generation', () => {
  it('preserves completed tasks and does not generate beyond the daily limit', async () => {
    const grammarFindMany = jest.fn();
    const existingTask = {
      id: 'task-1',
      userId: 'user-1',
      grammarId: 'grammar-1',
      taskDate: localDate('Asia/Tokyo').value,
      type: TaskType.LEARN,
      status: TaskStatus.COMPLETED,
      idempotencyKey: 'user-1:today:LEARN:grammar-1',
      studySession: null,
      grammar: { progress: [] },
    };
    const transaction = jest.fn((callback: (tx: object) => unknown) =>
      Promise.resolve(callback({})),
    );
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue({
          level: 'N1',
          dailyMinutes: 20,
          dailyNewLimit: 1,
        }),
      },
      reviewSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      studyTask: { findMany: jest.fn().mockResolvedValue([existingTask]) },
      grammarPoint: { findMany: grammarFindMany },
      $transaction: transaction,
    };

    await new DashboardService(prisma as never).ensureDailyTasks(
      'user-1',
      'Asia/Tokyo',
    );

    expect(grammarFindMany).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('reactivates a same-day learning task skipped by a replaced plan', async () => {
    const upsert = jest.fn(
      (input: {
        where: { idempotencyKey: string };
        update: {
          planId: string;
          status: TaskStatus;
          skipReason: null;
        };
      }) => Promise.resolve(input),
    );
    const prisma = {
      studyPlan: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'plan-2',
          level: 'N1',
          dailyMinutes: 20,
          dailyNewLimit: 1,
        }),
      },
      reviewSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      studyTask: { findMany: jest.fn().mockResolvedValue([]) },
      grammarPoint: {
        findMany: jest.fn().mockResolvedValue([{ id: 'grammar-1' }]),
      },
      $transaction: jest.fn(
        (callback: (tx: { studyTask: { upsert: typeof upsert } }) => unknown) =>
          Promise.resolve(callback({ studyTask: { upsert } })),
      ),
    };

    await new DashboardService(prisma as never).ensureDailyTasks(
      'user-1',
      'Asia/Tokyo',
    );

    expect(upsert).toHaveBeenCalledTimes(1);
    const input = upsert.mock.calls[0][0];
    expect(input.where.idempotencyKey).toContain(':LEARN:grammar-1');
    expect(input.update).toMatchObject({
      planId: 'plan-2',
      status: TaskStatus.PENDING,
      skipReason: null,
    });
  });

  it('keeps legacy fields while exposing schedule-backed atomic counts', async () => {
    const dueAt = new Date('2026-08-01T00:00:00.000Z');
    const task = (id: string, status: TaskStatus) => ({
      id,
      type: TaskType.REVIEW,
      status,
      createdAt: new Date('2026-08-11T00:00:00.000Z'),
      grammar: {
        progress: [
          {
            status: ProgressStatus.LEARNING,
            lastScore: 80,
            schedule: { nextReviewAt: dueAt },
          },
        ],
      },
    });
    const prisma = {
      studyTask: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            task('pending-overdue', TaskStatus.PENDING),
            task('completed-overdue', TaskStatus.COMPLETED),
          ]),
        count: jest.fn().mockResolvedValue(0),
      },
      userGrammarProgress: {
        groupBy: jest.fn().mockResolvedValue([
          { status: ProgressStatus.MASTERED, _count: { _all: 9 } },
          { status: ProgressStatus.LEARNING, _count: { _all: 1 } },
        ]),
      },
      grammarPoint: { count: jest.fn().mockResolvedValue(40) },
      reviewSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            progressId: 'progress-1',
            nextReviewOn: dueAt,
            nextReviewAt: dueAt,
            progress: { grammarId: 'grammar-1' },
          },
        ]),
      },
      reviewEvent: { count: jest.fn().mockResolvedValue(0) },
      studySession: {
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { activeSeconds: null } }),
      },
    };
    const service = new DashboardService(prisma as never);
    jest
      .spyOn(service, 'ensureDailyTasks')
      .mockResolvedValue({ level: 'N1' } as never);

    const result = await service.getToday('user-1', 'Asia/Tokyo');

    expect(result.summary).toMatchObject({
      newCount: 0,
      reviewCount: 1,
      completedCount: 1,
      overdueReviewCount: 1,
      dueTodayReviewCount: 0,
      upcomingReviewCount: 0,
      pendingReviewCount: 1,
      inProgressReviewCount: 0,
      plannedReviewRemainingCount: 1,
      pendingNewCount: 0,
      inProgressNewCount: 0,
      completedTodayCount: 0,
      completedTodayReviewCount: 0,
      completedTodayNewCount: 0,
      caughtUpOverdueTodayCount: 0,
      studyMinutesToday: 0,
      masteryPercent: 23,
      masteredGrammar: 9,
      learningGrammar: 1,
      needsWorkGrammar: 0,
      notStartedGrammar: 30,
      unmasteredGrammar: 31,
      learnedGrammar: 10,
      trackedGrammar: 10,
    });
    expect(result.planning).toMatchObject({
      dueUnscheduledCount: 1,
      overdueUnscheduledCount: 1,
      dueTodayUnscheduledCount: 0,
      planAtRisk: true,
    });
    expect(result.tasks[0]).toMatchObject({
      dueOn: '2026-08-01',
    });
    expect(typeof result.tasks[0].overdueDays).toBe('number');
    expect(prisma.userGrammarProgress.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-1',
          grammar: { level: 'N1', status: 'PUBLISHED' },
        },
      }),
    );
  });
});
