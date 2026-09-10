import {
  ProgressStatus,
  RecallRating,
  ReviewMemoryState,
  SessionMode,
  SessionStatus,
} from '@prisma/client';
import { StudySessionsService } from './study-sessions.service';

const now = new Date('2026-08-20T03:00:00Z');
const goodAi = {
  totalScore: 90,
  usedTargetGrammar: true,
  targetGrammarCorrect: true,
  scenarioTaskCompleted: true,
};

function fixture(ai: typeof goodAi | null = goodAi) {
  const session = {
    id: 'session-1',
    userId: 'user-1',
    grammarId: 'grammar-1',
    taskId: 'task-1',
    mode: SessionMode.REVIEW,
    status: SessionStatus.ACTIVE as SessionStatus,
    activeSeconds: 0,
    lastActivityAt: new Date(now.getTime() - 30_000),
    createdAt: new Date(now.getTime() - 60_000),
    scenarioId: null as string | null,
    trainingContext: null as unknown,
    trainingMode: null as string | null,
    hintRevealCount: 0,
  };
  const progress = {
    id: 'progress-1',
    status: ProgressStatus.LEARNING as ProgressStatus,
    needsWork: false,
    schedule: {
      nextReviewAt: new Date('2026-08-20T00:00:00Z'),
      nextReviewOn: new Date('2026-08-20T00:00:00Z'),
      lastReviewAt: new Date('2026-07-20T00:00:00Z'),
      stability: 30,
      difficulty: 5,
      fsrsState: ReviewMemoryState.REVIEW,
      scheduledDays: 31,
      elapsedDays: 31,
      reps: 5,
      lapses: 0,
      stateSource: 'NATIVE',
    },
  };
  let event: Record<string, unknown> | null = null;
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ learningV2Enabled: true, timezone: 'Asia/Tokyo' }),
    },
    studySession: {
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(session)),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          if (
            data.activeSeconds &&
            typeof data.activeSeconds === 'object' &&
            'increment' in data.activeSeconds
          )
            session.activeSeconds += Number(data.activeSeconds.increment);
          if (data.status) session.status = data.status as SessionStatus;
          if (data.lastActivityAt)
            session.lastActivityAt = data.lastActivityAt as Date;
          return Promise.resolve({ ...session });
        }),
    },
    userGrammarProgress: {
      upsert: jest.fn().mockResolvedValue(progress),
      update: jest.fn().mockResolvedValue({}),
    },
    sentenceAttempt: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'first-attempt', aiJob: { result: ai } }),
    },
    aiReviewJob: {
      findUnique: jest.fn().mockResolvedValue({
        result: goodAi,
        attempt: { studySessionId: session.id },
      }),
    },
    reviewEvent: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockImplementation(() => Promise.resolve(event)),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => {
          event = { id: 'event-1', ...data };
          return Promise.resolve(event);
        }),
    },
    reviewSchedule: { upsert: jest.fn().mockResolvedValue({}) },
    studyTask: { update: jest.fn().mockResolvedValue({}) },
    studyActivityDay: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { activeSeconds: 0 } }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    dailyStudyStat: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const service = new StudySessionsService(prisma as never);
  const complete = (
    rating: RecallRating = RecallRating.REMEMBERED,
    sentenceReviewId?: string,
  ) =>
    service.complete(session.userId, 'Asia/Tokyo', session.id, {
      recallRating: rating,
      sentenceReviewId,
    });
  return { tx, session, progress, complete };
}

function firstInput(mock: { mock: { calls: unknown[][] } }) {
  return mock.mock.calls[0][0] as {
    data: Record<string, unknown>;
    create: Record<string, unknown>;
  };
}

describe('V2 session completion', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(now));
  afterEach(() => jest.useRealTimers());

  it('locks user, session and grammar before reading/updating memory', async () => {
    const f = fixture();
    await f.complete();
    const statements = f.tx.$queryRaw.mock.calls.map(
      ([sql]: [{ strings: string[] }]) => sql.strings.join('?'),
    );
    expect(statements[0]).toContain('FROM "User"');
    expect(statements[1]).toContain('FROM "StudySession"');
    expect(statements[2]).toContain('pg_advisory_xact_lock');
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      evidenceVersion: 'mastery-v2',
      firstAttemptId: 'first-attempt',
      firstScore: 90,
      dueReview: true,
      crossScenarioValid: false,
      targetGrammarCorrect: true,
    });
  });

  it('cannot bypass a failed first attempt by selecting a later successful review', async () => {
    const f = fixture(null);
    const result = await f.complete(RecallRating.REMEMBERED, 'later-success');
    expect(f.tx.sentenceAttempt.findFirst).toHaveBeenCalledWith({
      where: { studySessionId: f.session.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { aiJob: { include: { result: true } } },
    });
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      firstAttemptId: 'first-attempt',
      firstScore: null,
      effectiveRating: RecallRating.FUZZY,
      aiEvidence: 'UNAVAILABLE',
    });
    expect(result.reviewOutcome?.nextReviewOn).toBe('2026-08-20');
    expect(f.tx.reviewSchedule.upsert).not.toHaveBeenCalled();
  });

  it('returns the original event on repeated completion without double-crediting anything', async () => {
    const f = fixture();
    const first = await f.complete();
    const second = await f.complete(RecallRating.FORGOT, 'stale-result');
    expect(second.reviewOutcome).toEqual(first.reviewOutcome);
    expect(f.tx.reviewEvent.create).toHaveBeenCalledTimes(1);
    expect(f.tx.studyTask.update).toHaveBeenCalledTimes(1);
    expect(f.tx.studyActivityDay.upsert).toHaveBeenCalledTimes(1);
    expect(firstInput(f.tx.studyActivityDay.upsert).create).toMatchObject({
      activeSeconds: 30,
    });
    expect(f.tx.dailyStudyStat.upsert).toHaveBeenCalledTimes(2); // time credit, then task/sentence counts
  });

  it('records hints for evidence and caps recalled success', async () => {
    const f = fixture();
    f.session.hintRevealCount = 1;
    await f.complete();
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      hintRevealCount: 1,
      effectiveRating: RecallRating.FUZZY,
    });
  });

  it('excludes a second due attempt on the same date even if the first had no score', async () => {
    const f = fixture();
    f.tx.reviewEvent.findMany.mockResolvedValueOnce([
      { reviewDate: new Date('2026-08-20T00:00:00Z'), dueReview: true },
    ]);
    await f.complete();
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      dueReview: false,
      affectsSchedule: false,
    });
    expect(f.tx.reviewSchedule.upsert).not.toHaveBeenCalled();
  });

  it('does not turn an unscored first gap check into a learned grammar or a due success', async () => {
    const f = fixture(null);
    f.progress.status = ProgressStatus.NOT_STARTED;
    await f.complete();
    expect(firstInput(f.tx.userGrammarProgress.update).data).toMatchObject({
      status: ProgressStatus.NOT_STARTED,
    });
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      dueReview: false,
    });
  });

  it('records initial learning successfully without claiming due-review mastery', async () => {
    const f = fixture();
    f.progress.status = ProgressStatus.NOT_STARTED;
    await f.complete();
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      dueReview: false,
      affectsSchedule: true,
    });
    expect(firstInput(f.tx.userGrammarProgress.update).data).toMatchObject({
      status: ProgressStatus.LEARNING,
    });
  });

  it('persists mastery only after full scored, dated and transferred evidence', async () => {
    const f = fixture();
    f.session.scenarioId = 'work';
    f.session.trainingMode = 'TRANSFER';
    const context = (id: string, objective: string) => ({
      scenario: {
        version: 'scenario-v1',
        scenarioId: id,
        taskId: `task-${id}`,
        objectiveId: objective,
        register: 'POLITE',
      },
    });
    f.session.trainingContext = context('work', 'negotiate-deadline');
    const past = (day: number) => ({
      evidenceVersion: 'mastery-v2',
      firstAttemptId: `attempt-${day}`,
      firstScore: 80,
      targetGrammarCorrect: true,
      dueReview: true,
      reviewDate: new Date(`2026-08-${day}T00:00:00Z`),
      submittedRating: RecallRating.REMEMBERED,
      effectiveRating: RecallRating.REMEMBERED,
      hintRevealCount: 0,
      scenarioTaskCompleted: true,
      crossScenarioValid: false,
    });
    f.tx.reviewEvent.findMany
      .mockResolvedValueOnce([past(18), past(15)])
      .mockResolvedValueOnce([
        {
          session: {
            scenarioId: 'travel',
            trainingContext: context('travel', 'ask-directions'),
          },
        },
      ]);
    await f.complete();
    expect(firstInput(f.tx.reviewEvent.create).data).toMatchObject({
      crossScenarioValid: true,
    });
    expect(firstInput(f.tx.userGrammarProgress.update).data).toMatchObject({
      status: ProgressStatus.MASTERED,
      masteryRuleVersion: 'mastery-v2',
    });
  });

  it('does not relabel legacy mastery as V2 when today has no qualifying score', async () => {
    const f = fixture(null);
    f.progress.status = ProgressStatus.MASTERED;
    await f.complete();
    expect(firstInput(f.tx.userGrammarProgress.update).data).toMatchObject({
      status: ProgressStatus.MASTERED,
      masteryRuleVersion: undefined,
    });
  });

  it('rejects another account and an abandoned session before writing any evidence', async () => {
    const f = fixture();
    f.tx.studySession.findUnique.mockResolvedValueOnce({
      ...f.session,
      userId: 'other-user',
    });
    await expect(f.complete()).rejects.toMatchObject({ status: 404 });
    f.session.status = SessionStatus.ABANDONED;
    await expect(f.complete()).rejects.toMatchObject({ status: 400 });
    expect(f.tx.reviewEvent.create).not.toHaveBeenCalled();
  });
});
