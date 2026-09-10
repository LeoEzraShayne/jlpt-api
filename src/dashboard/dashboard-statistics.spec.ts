import { JlptLevel, TaskStatus, TaskType } from '@prisma/client';
import {
  buildLearningTaskStatistics,
  loadDashboardStatistics,
} from './dashboard-statistics';

describe('dashboard statistics', () => {
  it('keeps pending and in-progress learning and review tasks separate', () => {
    const tasks = [
      { type: TaskType.LEARN, status: TaskStatus.PENDING },
      { type: TaskType.LEARN, status: TaskStatus.IN_PROGRESS },
      { type: TaskType.LEARN, status: TaskStatus.COMPLETED },
      { type: TaskType.REVIEW, status: TaskStatus.PENDING },
      { type: TaskType.REVIEW, status: TaskStatus.IN_PROGRESS },
      { type: TaskType.REVIEW, status: TaskStatus.COMPLETED },
    ];

    expect(buildLearningTaskStatistics(tasks)).toEqual({
      pendingNewCount: 1,
      inProgressNewCount: 1,
      pendingReviewCount: 1,
      inProgressReviewCount: 1,
      plannedReviewRemainingCount: 2,
    });
  });

  it('uses schedules as the backlog source and separates budget overflow', async () => {
    const schedules = [
      schedule('p1', 'g1', '2026-09-05'),
      schedule('p2', 'g2', '2026-09-06'),
      schedule('p3', 'g3', '2026-09-07'),
      schedule('p4', 'g4', '2026-09-07'),
      schedule('p5', 'g5', '2026-09-08'),
      schedule('p6', 'g6', '2026-09-14'),
      schedule('p7', 'g7', '2026-09-15'),
      {
        progressId: 'p8',
        nextReviewOn: null,
        nextReviewAt: new Date('2026-09-06T18:00:00.000Z'),
        progress: { grammarId: 'g8' },
      },
    ];
    const reviewInputs: WhereCall[] = [];
    const reviewCount = jest.fn((input: WhereCall) => {
      reviewInputs.push(input);
      return Promise.resolve(reviewInputs.length === 1 ? 6 : 4);
    });
    let completedNewInput: WhereCall | undefined;
    const studyTaskCount = jest.fn((input: WhereCall) => {
      completedNewInput = input;
      return Promise.resolve(5);
    });
    let aggregateInput: WhereCall | undefined;
    const sessionAggregate = jest.fn((input: WhereCall) => {
      aggregateInput = input;
      return Promise.resolve({ _sum: { activeSeconds: 1501 } });
    });
    const scheduleFindMany = jest.fn().mockResolvedValue(schedules);
    const prisma = {
      reviewSchedule: { findMany: scheduleFindMany },
      studyTask: { count: studyTaskCount },
      reviewEvent: { count: reviewCount },
      studySession: { aggregate: sessionAggregate },
    };

    const result = await loadDashboardStatistics(prisma as never, {
      userId: 'user-1',
      timezone: 'Asia/Tokyo',
      todayKey: '2026-09-07',
      level: JlptLevel.N1,
      plannedReviews: [
        { progressId: 'p1', grammarId: 'g1' },
        { progressId: null, grammarId: 'g3' },
      ],
    });

    expect(result).toEqual({
      overdueReviewCount: 2,
      dueTodayReviewCount: 3,
      overdueUnscheduledCount: 1,
      dueTodayUnscheduledCount: 2,
      upcomingReviewCount: 2,
      completedTodayCount: 11,
      completedTodayReviewCount: 6,
      completedTodayNewCount: 5,
      caughtUpOverdueTodayCount: 4,
      studyMinutesToday: 26,
    });
    expect(completedNewInput).toBeDefined();
    const completedNewWhere = completedNewInput!.where;
    expect(completedNewWhere).toMatchObject({
      type: TaskType.LEARN,
      completedAt: {
        gte: new Date('2026-09-06T15:00:00.000Z'),
        lt: new Date('2026-09-07T15:00:00.000Z'),
      },
    });
    expect(completedNewWhere).not.toHaveProperty('taskDate');
    expect(aggregateInput).toMatchObject({
      where: {
        completedAt: {
          gte: new Date('2026-09-06T15:00:00.000Z'),
          lt: new Date('2026-09-07T15:00:00.000Z'),
        },
      },
      _sum: { activeSeconds: true },
    });
    expect(reviewInputs[0].where).not.toHaveProperty('scheduledFor');
    expect(reviewInputs[1].where).toMatchObject({
      affectsSchedule: true,
      scheduledFor: { lt: new Date('2026-09-07T00:00:00.000Z') },
      OR: [
        { task: { is: { type: TaskType.REVIEW } } },
        { taskId: null, session: { mode: 'REVIEW' } },
      ],
    });
    expect(scheduleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          progress: {
            userId: 'user-1',
            grammar: {
              is: { level: JlptLevel.N1, status: 'PUBLISHED' },
            },
          },
        },
      }),
    );
  });

  it('includes a taskless review-session catch-up in review totals', async () => {
    const reviewCount = jest.fn().mockResolvedValueOnce(1).mockResolvedValue(1);
    const prisma = {
      reviewSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      studyTask: { count: jest.fn().mockResolvedValue(0) },
      reviewEvent: { count: reviewCount },
      studySession: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: { activeSeconds: 240 },
        }),
      },
    };

    const result = await loadDashboardStatistics(prisma as never, {
      userId: 'user-1',
      timezone: 'Asia/Tokyo',
      todayKey: '2026-09-07',
      plannedReviews: [],
    });

    expect(result.completedTodayCount).toBe(1);
    expect(result.completedTodayReviewCount).toBe(1);
    expect(result.caughtUpOverdueTodayCount).toBe(1);
    expect(prisma.reviewSchedule.findMany).not.toHaveBeenCalled();
  });

  it.each([
    [
      'America/New_York spring-forward day',
      '2026-03-08',
      new Date('2026-03-08T05:00:00.000Z'),
      new Date('2026-03-09T04:00:00.000Z'),
    ],
    [
      'America/New_York fall-back day',
      '2026-11-01',
      new Date('2026-11-01T04:00:00.000Z'),
      new Date('2026-11-02T05:00:00.000Z'),
    ],
  ])(
    'uses the exact local-day range on %s',
    async (_, todayKey, start, end) => {
      let completedNewInput: WhereCall | undefined;
      const prisma = {
        reviewSchedule: { findMany: jest.fn() },
        studyTask: {
          count: jest.fn((input: WhereCall) => {
            completedNewInput = input;
            return Promise.resolve(0);
          }),
        },
        reviewEvent: { count: jest.fn().mockResolvedValue(0) },
        studySession: {
          aggregate: jest.fn().mockResolvedValue({
            _sum: { activeSeconds: null },
          }),
        },
      };

      await loadDashboardStatistics(prisma as never, {
        userId: 'user-1',
        timezone: 'America/New_York',
        todayKey,
        plannedReviews: [],
      });

      expect(completedNewInput?.where.completedAt).toEqual({
        gte: start,
        lt: end,
      });
      expect(prisma.reviewSchedule.findMany).not.toHaveBeenCalled();
    },
  );
});

function schedule(progressId: string, grammarId: string, dueKey: string) {
  const due = new Date(`${dueKey}T00:00:00.000Z`);
  return {
    progressId,
    nextReviewOn: due,
    nextReviewAt: due,
    progress: { grammarId },
  };
}

type WhereCall = { where: Record<string, unknown>; _sum?: unknown };
