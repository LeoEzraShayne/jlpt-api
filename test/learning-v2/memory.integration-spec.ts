/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Supertest JSON bodies are deliberately validated by runtime assertions. */
import { startHarness, type Harness } from './harness';
import {
  reviewedAttempt,
  existingProgress,
  reviewSession,
  freezeDate,
} from './review-fixtures';
import { localDateKey } from '../../src/review/adaptive-review';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterEach(() => jest.useRealTimers());
afterAll(async () => {
  await h?.stop();
});

test.each([
  {
    label: '79',
    score: 79,
    hint: false,
    correct: true,
    rating: 'REMEMBERED',
    state: 'LEARNING',
    effective: 'FUZZY',
  },
  {
    label: '80',
    score: 80,
    hint: false,
    correct: true,
    rating: 'REMEMBERED',
    state: 'LEARNING',
    effective: 'REMEMBERED',
  },
  {
    label: 'hint',
    score: 100,
    hint: true,
    correct: true,
    rating: 'REMEMBERED',
    state: 'LEARNING',
    effective: 'FUZZY',
  },
  {
    label: 'wrong-target',
    score: 90,
    hint: false,
    correct: false,
    rating: 'REMEMBERED',
    state: 'NEEDS_WORK',
    effective: 'FORGOT',
  },
  {
    label: 'forgot',
    score: 100,
    hint: false,
    correct: true,
    rating: 'FORGOT',
    state: 'NEEDS_WORK',
    effective: 'FORGOT',
  },
  {
    label: 'missing',
    score: null,
    hint: false,
    correct: true,
    rating: 'REMEMBERED',
    state: 'LEARNING',
    effective: 'FUZZY',
  },
])(
  'due completion $label persists first evidence and appropriate schedule',
  async ({ label, score, hint, correct, rating, state, effective }) => {
    const { user, http } = await h.login(`memory-${label}`);
    const progress = await existingProgress(h, user.id);
    const session = await reviewSession(h, user.id);
    const { attempt } = await reviewedAttempt(h, session, score, correct);
    if (hint)
      await http.post(`/study-sessions/${session.id}/reveal`).expect(201);
    await http
      .post(`/study-sessions/${session.id}/complete`, { recallRating: rating })
      .expect(201);
    const event = await h.prisma.reviewEvent.findUniqueOrThrow({
      where: { sessionId: session.id },
    });
    expect(event).toMatchObject({
      firstAttemptId: attempt.id,
      firstScore: score,
      dueReview: true,
      effectiveRating: effective,
      evidenceVersion: 'mastery-v2',
    });
    expect(
      (
        await h.prisma.userGrammarProgress.findUniqueOrThrow({
          where: { id: progress.id },
        })
      ).status,
    ).toBe(state);
    const schedule = await h.prisma.reviewSchedule.findUniqueOrThrow({
      where: { progressId: progress.id },
    });
    if (score === null) {
      expect(schedule.stability).toBe(progress.schedule!.stability);
      expect(schedule.nextReviewOn).toEqual(progress.schedule!.nextReviewOn);
    } else if (effective === 'FORGOT' || effective === 'FUZZY') {
      expect(schedule.nextReviewOn!.getTime()).toBeLessThanOrEqual(
        Date.now() + 86400000,
      );
    } else
      expect(schedule.nextReviewOn!.getTime()).toBeGreaterThan(
        Date.now() + 30 * 86400000,
      );
  },
);

test('later perfect retry cannot replace failed or missing first attempt; completion is idempotent across requests', async () => {
  const { user, http } = await h.login('memory-retry');
  const p = await existingProgress(h, user.id);
  const session = await reviewSession(h, user.id);
  const first = await reviewedAttempt(h, session, null);
  const later = await reviewedAttempt(h, session, 100);
  // Ensure deterministic first ordering even on a very fast database.
  await h.prisma.sentenceAttempt.update({
    where: { id: first.attempt.id },
    data: { createdAt: new Date(Date.now() - 5000) },
  });
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      http
        .post(`/study-sessions/${session.id}/complete`, {
          recallRating: 'REMEMBERED',
          sentenceReviewId: later.job!.id,
        })
        .expect(201),
    ),
  );
  expect(responses.every((r) => r.body.data.status === 'COMPLETED')).toBe(true);
  expect(
    await h.prisma.reviewEvent.count({ where: { sessionId: session.id } }),
  ).toBe(1);
  const event = await h.prisma.reviewEvent.findUniqueOrThrow({
    where: { sessionId: session.id },
  });
  expect(event.firstAttemptId).toBe(first.attempt.id);
  expect(event.firstScore).toBeNull();
  expect(
    (
      await h.prisma.userGrammarProgress.findUniqueOrThrow({
        where: { id: p.id },
      })
    ).reviewCount,
  ).toBe(5);
  expect(
    (
      await h.prisma.reviewSchedule.findUniqueOrThrow({
        where: { progressId: p.id },
      })
    ).reps,
  ).toBe(4);
});

test.each([false, true])(
  'three distinct due dates need actual new objective; transferred=%s',
  async (transfer) => {
    const { user, http } = await h.login(`memory-mastery-${transfer}`);
    freezeDate(new Date());
    const p = await existingProgress(h, user.id);
    for (let i = 0; i < 3; i++) {
      const schedule = await h.prisma.reviewSchedule.findUniqueOrThrow({
        where: { progressId: p.id },
      });
      if (i > 0)
        jest.setSystemTime(
          new Date(schedule.nextReviewOn!.getTime() + 3 * 3600000),
        );
      // Long-lived HTTP cookie auth is renewed through real AuthService as simulated days advance.
      const login =
        i > 0 ? await h.login(`memory-mastery-${transfer}`) : { http };
      const session = await reviewSession(
        h,
        user.id,
        `scene-${i}`,
        transfer ? `objective-${i}` : 'same-objective',
      );
      await reviewedAttempt(h, session, 80);
      await login.http
        .post(`/study-sessions/${session.id}/complete`, {
          recallRating: 'REMEMBERED',
        })
        .expect(201);
    }
    const events = await h.prisma.reviewEvent.findMany({
      where: { progressId: p.id },
      orderBy: { reviewedAt: 'asc' },
    });
    expect(events).toHaveLength(3);
    expect(new Set(events.map((e) => e.reviewDate!.toISOString())).size).toBe(
      3,
    );
    expect(events.every((e) => e.dueReview && e.firstScore === 80)).toBe(true);
    expect(events[2].crossScenarioValid).toBe(transfer);
    expect(
      (
        await h.prisma.userGrammarProgress.findUniqueOrThrow({
          where: { id: p.id },
        })
      ).status,
    ).toBe(transfer ? 'MASTERED' : 'LEARNING');
  },
);

test('early and same-day parallel success do not manufacture evidence or advance twice; overdue alone does not demote', async () => {
  const { user, http } = await h.login('memory-early');
  const p = await existingProgress(h, user.id, 20, 'MASTERED');
  const session = await reviewSession(h, user.id);
  await reviewedAttempt(h, session, 100);
  await http
    .post(`/study-sessions/${session.id}/complete`, {
      recallRating: 'REMEMBERED',
    })
    .expect(201);
  let event = await h.prisma.reviewEvent.findUniqueOrThrow({
    where: { sessionId: session.id },
  });
  expect(event.dueReview).toBe(false);
  expect(event.affectsSchedule).toBe(false);
  const overdue = new Date(`${localDateKey('Asia/Tokyo')}T00:00:00Z`);
  overdue.setUTCDate(overdue.getUTCDate() - 10);
  await h.prisma.reviewSchedule.update({
    where: { progressId: p.id },
    data: { nextReviewAt: overdue, nextReviewOn: overdue },
  });
  await http.get('/dashboard/today').expect(200);
  expect(
    (
      await h.prisma.userGrammarProgress.findUniqueOrThrow({
        where: { id: p.id },
      })
    ).status,
  ).toBe('MASTERED');
  const sessions = await Promise.all([
    reviewSession(h, user.id),
    reviewSession(h, user.id),
  ]);
  for (const s of sessions) await reviewedAttempt(h, s, 100);
  await Promise.all(
    sessions.map((s) =>
      http
        .post(`/study-sessions/${s.id}/complete`, {
          recallRating: 'REMEMBERED',
        })
        .expect(201),
    ),
  );
  const events = await h.prisma.reviewEvent.findMany({
    where: { sessionId: { in: sessions.map((s) => s.id) } },
  });
  expect(events.filter((e) => e.dueReview)).toHaveLength(1);
  expect(events.filter((e) => e.affectsSchedule)).toHaveLength(1);
  event = events.find((e) => e.dueReview)!;
  expect(event.firstScore).toBe(100);
});

test('initial learning and early-start review crossing due midnight cannot count toward mastery', async () => {
  freezeDate(new Date('2026-09-10T14:59:30Z'));
  const { user, http } = await h.login('memory-initial-crossday');
  const initial = await reviewSession(
    h,
    user.id,
    'initial',
    'initial',
    'LEARN',
  );
  await reviewedAttempt(h, initial, 100);
  await http
    .post(`/study-sessions/${initial.id}/complete`, {
      recallRating: 'REMEMBERED',
    })
    .expect(201);
  const initialEvent = await h.prisma.reviewEvent.findUniqueOrThrow({
    where: { sessionId: initial.id },
  });
  expect(initialEvent.dueReview).toBe(false);
  const progress = await h.prisma.userGrammarProgress.findUniqueOrThrow({
    where: { userId_grammarId: { userId: user.id, grammarId: 'f-N1-0' } },
  });
  expect(progress.status).toBe('LEARNING');
  await h.prisma.reviewSchedule.update({
    where: { progressId: progress.id },
    data: {
      nextReviewAt: new Date('2026-09-11T00:00:00Z'),
      nextReviewOn: new Date('2026-09-11T00:00:00Z'),
    },
  });
  const early = await reviewSession(h, user.id, 'early', 'early');
  jest.setSystemTime(new Date('2026-09-10T15:00:30Z'));
  await reviewedAttempt(h, early, 100);
  await http
    .post(`/study-sessions/${early.id}/complete`, {
      recallRating: 'REMEMBERED',
    })
    .expect(201);
  const event = await h.prisma.reviewEvent.findUniqueOrThrow({
    where: { sessionId: early.id },
  });
  expect(event.dueReview).toBe(false);
  expect(event.affectsSchedule).toBe(false);
  expect(
    await h.prisma.reviewEvent.count({
      where: { userId: user.id, dueReview: true },
    }),
  ).toBe(0);
});
