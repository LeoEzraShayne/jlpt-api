import { ConflictException } from '@nestjs/common';
import {
  JlptLevel,
  ProgressStatus,
  RecallRating,
  SessionMode,
  SessionStatus,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { localDateKey } from '../review/adaptive-review';
import { StudySessionsService } from './study-sessions.service';

const grammar = { id: 'grammar-1', level: JlptLevel.N1, examples: [] };

function transactionDefaults<T extends object>(client: T) {
  return Object.assign(client, {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        targetLevel: JlptLevel.N1,
        timezone: 'Asia/Tokyo',
        learningV2Enabled: false,
      }),
    },
    studyActivityDay: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { activeSeconds: 0 } }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    ...(!('dailyStudyStat' in client)
      ? { dailyStudyStat: { upsert: jest.fn().mockResolvedValue({}) } }
      : {}),
  });
}
function transactional<T extends object>(client: T) {
  const tx = transactionDefaults(client);
  return {
    ...tx,
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
}

describe('StudySessionsService task gating', () => {
  it('counts every hint reveal in an active review session', async () => {
    const now = new Date('2026-09-07T07:30:00.000Z');
    const session = {
      id: 'review-session',
      userId: 'user-1',
      mode: SessionMode.REVIEW,
      status: SessionStatus.ACTIVE,
      revealedAt: null,
      hintRevealCount: 0,
      timerPhase: 'FOCUS',
      timerPhaseStartedAt: now,
      timerPhaseEndsAt: new Date(now.getTime() + 600_000),
    };
    const update = jest.fn().mockResolvedValue({
      ...session,
      revealedAt: now,
      hintRevealCount: 1,
    });
    const prisma = {
      studySession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update,
      },
    };

    await new StudySessionsService(transactional(prisma) as never).reveal(
      'user-1',
      session.id,
    );

    const [input] = update.mock.calls[0] as unknown as [
      {
        where: { id: string };
        data: { revealedAt: Date; hintRevealCount: { increment: number } };
      },
    ];
    expect(input).toMatchObject({
      where: { id: session.id },
      data: {
        hintRevealCount: { increment: 1 },
      },
    });
    expect(input.data.revealedAt).toBeInstanceOf(Date);
  });

  it('rejects a scheduled learning task while required reviews remain', async () => {
    const prisma = {
      grammarPoint: { findUnique: jest.fn().mockResolvedValue(grammar) },
      studyTask: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'learn-task',
          userId: 'user-1',
          grammarId: grammar.id,
          taskDate: new Date('2026-08-11T00:00:00.000Z'),
          type: TaskType.LEARN,
          status: TaskStatus.PENDING,
        }),
        count: jest.fn().mockResolvedValue(2),
      },
      studySession: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new StudySessionsService(transactional(prisma) as never);

    await expect(
      service.create('user-1', 'Asia/Tokyo', {
        grammarId: grammar.id,
        taskId: 'learn-task',
        mode: SessionMode.LEARN,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.studyTask.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        taskDate: new Date(`${localDateKey('Asia/Tokyo')}T00:00:00.000Z`),
        type: TaskType.REVIEW,
        status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        plan: {
          status: 'ACTIVE',
          startDate: {
            lte: new Date(`${localDateKey('Asia/Tokyo')}T00:00:00.000Z`),
          },
        },
        grammar: { level: JlptLevel.N1 },
      },
    });
  });

  it('automatically links review queue sessions to the matching today task', async () => {
    const reviewTask = {
      id: 'review-task',
      userId: 'user-1',
      grammarId: grammar.id,
      taskDate: new Date('2026-08-11T00:00:00.000Z'),
      type: TaskType.REVIEW,
      status: TaskStatus.PENDING,
    };
    const prisma = {
      grammarPoint: { findUnique: jest.fn().mockResolvedValue(grammar) },
      studyTask: {
        findFirst: jest.fn().mockResolvedValue(reviewTask),
        findUnique: jest.fn().mockResolvedValue(reviewTask),
        update: jest.fn().mockResolvedValue({}),
      },
      studySession: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'session-1',
            status: 'ACTIVE',
            ...data,
          }),
        ),
      },
    };
    const service = new StudySessionsService(transactional(prisma) as never);

    const result = await service.create('user-1', 'Asia/Tokyo', {
      grammarId: grammar.id,
      mode: SessionMode.REVIEW,
    });

    expect(prisma.studySession.create).toHaveBeenCalledTimes(1);
    expect(prisma.studyTask.update).toHaveBeenCalledWith({
      where: { id: reviewTask.id },
      data: { status: 'IN_PROGRESS' },
    });
    expect(result.session.id).toBe('session-1');
    expect(result.session.taskId).toBe(reviewTask.id);
  });

  it('records a review event and returns an idempotent outcome on completion', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T03:00:00.000Z'));
    const session = {
      id: 'session-1',
      userId: 'user-1',
      grammarId: grammar.id,
      taskId: null,
      mode: SessionMode.LEARN,
      status: SessionStatus.ACTIVE,
      activeSeconds: 0,
      lastActivityAt: new Date('2026-08-12T02:59:00.000Z'),
    };
    const reviewEventCreate = jest.fn(
      ({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'event-1',
          ...data,
        }),
    );
    const dailyStudyStatUpsert = jest.fn(
      (input: { create: { studyMinutes: number } }) => Promise.resolve(input),
    );
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: session.id }]),
      studySession: {
        findUnique: jest.fn().mockResolvedValue(session),
        update: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ ...session, ...data }),
          ),
      },
      userGrammarProgress: {
        upsert: jest.fn().mockResolvedValue({
          id: 'progress-1',
          stage: 0,
          masteryScore: 0,
          status: ProgressStatus.NOT_STARTED,
          schedule: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      sentenceAttempt: { findFirst: jest.fn().mockResolvedValue(null) },
      reviewEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: reviewEventCreate,
      },
      reviewSchedule: { upsert: jest.fn().mockResolvedValue({}) },
      dailyStudyStat: { upsert: dailyStudyStatUpsert },
      studyTask: { findUnique: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      aiReviewJob: { findUnique: jest.fn() },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(transactionDefaults(tx))),
      ),
    };
    const service = new StudySessionsService(prisma as never);

    const result = await service.complete('user-1', 'Asia/Tokyo', session.id, {
      recallRating: RecallRating.REMEMBERED,
    });

    const [reviewEventInput] = reviewEventCreate.mock.calls[0];
    expect(reviewEventInput.data).toMatchObject({
      sessionId: session.id,
      submittedRating: RecallRating.REMEMBERED,
      effectiveRating: RecallRating.REMEMBERED,
      aiEvidence: 'UNAVAILABLE',
    });
    expect(result.reviewOutcome).toMatchObject({
      effectiveRating: RecallRating.REMEMBERED,
      isEstimate: true,
    });
    const [dailyStatInput] = dailyStudyStatUpsert.mock.calls[0];
    expect(dailyStatInput.create.studyMinutes).toBe(1);
    jest.useRealTimers();
  });

  it('credits at most ninety seconds per activity heartbeat', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-12T03:00:00.000Z'));
    const update = jest.fn().mockResolvedValue({ activeSeconds: 90 });
    const tx = {
      studySession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          userId: 'user-1',
          status: SessionStatus.ACTIVE,
          activeSeconds: 0,
          lastActivityAt: new Date('2026-08-12T02:55:00.000Z'),
        }),
        update,
      },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(transactionDefaults(tx))),
      ),
    };
    const result = await new StudySessionsService(
      prisma as never,
    ).recordActivity('user-1', 'session-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: {
        activeSeconds: { increment: 90 },
        lastActivityAt: new Date('2026-08-12T03:00:00.000Z'),
      },
    });
    expect(result).toEqual({ activeSeconds: 90, accepted: true });
    jest.useRealTimers();
  });
});
