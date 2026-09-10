import { DashboardService, localDate } from './dashboard.service';

const today = () => localDate('Asia/Tokyo').value;
const plan = (level = 'N1', mode = 'SYSTEM') => ({
  id: `plan-${level}`,
  level,
  mode,
  dailyNewLimit: 2,
  status: 'ACTIVE',
  startDate: new Date('2020-01-01'),
});
const grammar = (id: string, level = 'N1') => ({ id, level, progress: [] });

interface MockTask {
  id: string;
  grammarId: string;
  grammar: ReturnType<typeof grammar>;
  type: string;
  status: string;
  studySession: null;
  taskDate?: Date;
  progressId?: string | null;
  estimatedMinutes?: number;
  idempotencyKey?: string;
}

function fixture() {
  const tasks: MockTask[] = [];
  const plans = [plan()];
  const user = {
    id: 'u',
    dailyMinutes: 20,
    primaryShare: 80,
    targetLevel: 'N1',
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue(user) },
    studyPlan: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve(plans)),
    },
    studyTask: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve([...tasks])),
      delete: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) => {
          tasks.splice(
            tasks.findIndex((task) => task.id === where.id),
            1,
          );
          return Promise.resolve({});
        }),
      update: jest
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: Partial<MockTask>;
          }) => {
            const task = tasks.find((item) => item.id === where.id)!;
            Object.assign(task, data);
            return Promise.resolve(task);
          },
        ),
      upsert: jest
        .fn()
        .mockImplementation(
          ({
            where,
            create,
            update,
          }: {
            where: { idempotencyKey: string };
            create: MockTask;
            update: Partial<MockTask>;
          }) => {
            let task = tasks.find(
              (item) => item.idempotencyKey === where.idempotencyKey,
            );
            if (!task) {
              task = {
                ...create,
                id: `task-${tasks.length}`,
                status: 'PENDING',
                studySession: null,
                grammar: grammar(create.grammarId),
              };
              tasks.push(task);
            } else Object.assign(task, update);
            return Promise.resolve(task);
          },
        ),
    },
    studySession: { findMany: jest.fn().mockResolvedValue([]) },
    studyActivityDay: { findMany: jest.fn().mockResolvedValue([]) },
    dailyStudyStat: { findUnique: jest.fn().mockResolvedValue(null) },
    reviewSchedule: { findMany: jest.fn().mockResolvedValue([]) },
    userGrammarProgress: { findMany: jest.fn().mockResolvedValue([]) },
    grammarPoint: {
      findMany: jest
        .fn()
        .mockImplementation(({ take }: { take: number }) =>
          Promise.resolve([grammar('g1'), grammar('g2')].slice(0, take)),
        ),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest
      .fn()
      .mockImplementation((callback: (input: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
  };
  return {
    tasks,
    plans,
    user,
    tx,
    service: new DashboardService(prisma as never),
  };
}

describe('DashboardService shared daily generation', () => {
  it('refresh reuses pending rows and never duplicates the budget', async () => {
    const { service, tasks, tx } = fixture();
    await service.ensureDailyTasks('u', 'Asia/Tokyo');
    await service.ensureDailyTasks('u', 'Asia/Tokyo');
    expect(tasks).toHaveLength(2);
    expect(
      tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0),
    ).toBe(16);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('preserves completed tasks and limits newly issued learning', async () => {
    const { service, tasks, tx } = fixture();
    tasks.push({
      id: 'done',
      grammarId: 'g1',
      grammar: grammar('g1'),
      taskDate: today(),
      type: 'LEARN',
      status: 'COMPLETED',
      studySession: null,
    });
    tx.grammarPoint.findMany.mockResolvedValue([grammar('g2')]);
    tx.dailyStudyStat.findUnique.mockResolvedValue({ studyMinutes: 12 });
    const result = await service.ensureDailyTasks('u', 'Asia/Tokyo');
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.id === 'done')!.status).toBe('COMPLETED');
    expect(result.allocation.spentMinutes).toBe(12);
    expect(result.allocation.remainingMinutes).toBe(0);
  });

  it('reuses a previous-day review even when progressId was missing', async () => {
    const { service, tasks, tx } = fixture();
    tasks.push({
      id: 'old',
      grammarId: 'g1',
      progressId: null,
      grammar: grammar('g1'),
      taskDate: new Date('2020-01-01'),
      type: 'REVIEW',
      status: 'PENDING',
      studySession: null,
    });
    tx.reviewSchedule.findMany.mockResolvedValue([
      {
        progressId: 'p1',
        nextReviewOn: new Date('2020-01-01'),
        nextReviewAt: new Date('2020-01-01'),
        progress: {
          grammarId: 'g1',
          grammar: grammar('g1'),
          status: 'LEARNING',
          masteryScore: 20,
          lastScore: 80,
        },
      },
    ]);
    tx.grammarPoint.findMany.mockResolvedValue([]);
    await service.ensureDailyTasks('u', 'Asia/Tokyo');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: 'old',
      progressId: 'p1',
      taskDate: today(),
    });
  });

  it('gap-fill schedules an untouched needs-work check but no ordinary new grammar', async () => {
    const { service, plans, tx, tasks } = fixture();
    plans.splice(0, 1, plan('N2', 'GAP_FILL'));
    tx.userGrammarProgress.findMany.mockResolvedValue([
      {
        id: 'p2',
        grammarId: 'g2',
        grammar: grammar('g2', 'N2'),
        status: 'NOT_STARTED',
      },
    ]);
    await service.ensureDailyTasks('u', 'Asia/Tokyo');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      type: 'REVIEW',
      progressId: 'p2',
      planId: 'plan-N2',
    });
    expect(tx.grammarPoint.findMany).not.toHaveBeenCalled();
  });

  it('all paused plans remove unstarted tasks while retaining historical completions', async () => {
    const { service, plans, tasks } = fixture();
    plans.splice(0);
    tasks.push({
      id: 'old',
      grammarId: 'g1',
      grammar: grammar('g1'),
      type: 'REVIEW',
      status: 'PENDING',
      studySession: null,
    });
    tasks.push({
      id: 'done',
      grammarId: 'g2',
      grammar: grammar('g2'),
      type: 'LEARN',
      status: 'COMPLETED',
      studySession: null,
    });
    const result = await service.ensureDailyTasks('u', 'Asia/Tokyo');
    expect(result.scheduledIds).toEqual(['done']);
    expect(tasks).toHaveLength(1);
  });
});
