/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- Supertest JSON bodies are deliberately validated by runtime assertions. */
import { startHarness, type Harness } from './harness';
import {
  localDateKey,
  addCalendarDays,
} from '../../src/review/adaptive-review';

const day = localDateKey('Asia/Tokyo');
const planInput = (level = 'N1') => ({
  level,
  startDate: `${day}T12:00:00Z`,
  targetDate: `${addCalendarDays(day, 90)}T12:00:00Z`,
  dailyMinutes: 40,
  dailyNewLimit: 10,
});
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});

async function due(userId: string, level: 'N1' | 'N2', count: number) {
  for (let i = 0; i < count; i++)
    await h.prisma.userGrammarProgress.create({
      data: {
        userId,
        grammarId: `f-${level}-${i}`,
        status: 'LEARNING',
        lastScore: 90,
        schedule: {
          create: {
            nextReviewAt: new Date(`${day}T00:00:00Z`),
            nextReviewOn: new Date(`${day}T00:00:00Z`),
          },
        },
      },
    });
}

test('HTTP cookie authentication and same-level concurrent create preserve one plan and primary', async () => {
  await h.http().get('/study-plans').expect(401);
  const { user, http } = await h.login('plan-concurrency');
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      http.post('/study-plans', planInput()).expect(201),
    ),
  );
  expect(new Set(responses.map((r) => String(r.body.data.id))).size).toBe(1);
  const n1 = responses[0].body.data.id;
  for (const level of ['N2', 'N3', 'N4'])
    await http.post('/study-plans', planInput(level)).expect(201);
  expect(await h.prisma.studyPlan.count({ where: { userId: user.id } })).toBe(
    4,
  );
  expect((await http.get('/me').expect(200)).body.data.targetLevel).toBe('N1');
  expect(
    (await http.get('/study-plans/current').expect(200)).body.data.id,
  ).toBe(n1);
  await http.patch(`/study-plans/${n1}`, { status: 'PAUSED' }).expect(200);
  expect(
    (await http.post('/study-plans', planInput()).expect(201)).body.data,
  ).toMatchObject({ id: n1, status: 'PAUSED' });
  await http.patch(`/study-plans/${n1}`, { status: 'ACTIVE' }).expect(200);
  const stranger = await h.login('plan-stranger');
  await stranger.http.get(`/study-plans/${n1}`).expect(404);
  await stranger.http
    .patch(`/study-plans/${n1}`, { status: 'PAUSED' })
    .expect(404);
});

test('80/20 allocation, concurrent refresh, backlog and group-local learning gate', async () => {
  const { user, http } = await h.login('budget-groups');
  await http.post('/study-plans', planInput()).expect(201);
  await http.post('/study-plans', planInput('N2')).expect(201);
  await due(user.id, 'N2', 20);
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => http.get('/dashboard/today').expect(200)),
  );
  const first = responses[0].body.data;
  expect(first.allocation).toMatchObject({
    primaryMinutes: 32,
    foundationMinutes: 8,
    primaryPlannedMinutes: 32,
    foundationPlannedMinutes: 8,
  });
  expect(first.backlog.count).toBe(18);
  const ids = first.tasks.map((t: { id: string }) => t.id).sort();
  for (const response of responses)
    expect(
      response.body.data.tasks.map((t: { id: string }) => t.id).sort(),
    ).toEqual(ids);
  expect(await h.prisma.studyTask.count({ where: { userId: user.id } })).toBe(
    6,
  );
  const newTask = first.tasks.find((t: { type: string }) => t.type === 'LEARN');
  expect(newTask.locked).toBe(false);
  await http
    .post('/study-sessions', {
      grammarId: newTask.grammarId,
      taskId: newTask.id,
      mode: 'LEARN',
    })
    .expect(201);
});

test('unused foundation lends to primary; paused primary lends to foundation; all paused stays initialized', async () => {
  const { user, http } = await h.login('budget-loans');
  const n1 = (await http.post('/study-plans', planInput()).expect(201)).body
    .data.id;
  const n2 = (await http.post('/study-plans', planInput('N2')).expect(201)).body
    .data.id;
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.allocation
      .primaryPlannedMinutes,
  ).toBe(40);
  await due(user.id, 'N2', 20);
  await http.patch(`/study-plans/${n1}`, { status: 'PAUSED' }).expect(200);
  const paused = (await http.get('/dashboard/today').expect(200)).body.data;
  expect(paused.allocation.foundationPlannedMinutes).toBe(40);
  expect(
    paused.tasks.every(
      (t: { grammar: { level: string } }) => t.grammar.level === 'N2',
    ),
  ).toBe(true);
  await http.patch(`/study-plans/${n2}`, { status: 'PAUSED' }).expect(200);
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.tasks,
  ).toEqual([]);
  expect(
    (await http.get('/study-plans').expect(200)).body.data.items,
  ).toHaveLength(2);
  await http
    .post('/study-sessions', { grammarId: 'f-N4-0', mode: 'PRACTICE' })
    .expect(201);
});

test('noon start is today; future plans excluded; gap mark never asserts learning', async () => {
  const { user, http } = await h.login('dates-gap');
  const n2 = (await http.post('/study-plans', planInput('N2')).expect(201)).body
    .data.id;
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.tasks,
  ).toEqual([]);
  await http
    .put('/grammar-points/f-N2-0/needs-work', { needsWork: true })
    .expect(200);
  const p = await h.prisma.userGrammarProgress.findUniqueOrThrow({
    where: { userId_grammarId: { userId: user.id, grammarId: 'f-N2-0' } },
  });
  expect(p.status).toBe('NOT_STARTED');
  expect(
    await h.prisma.reviewSchedule.count({ where: { progressId: p.id } }),
  ).toBe(0);
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.tasks,
  ).toHaveLength(1);
  await http
    .patch(`/study-plans/${n2}`, {
      startDate: `${addCalendarDays(day, 1)}T12:00:00Z`,
    })
    .expect(200);
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.tasks,
  ).toHaveLength(0);
  await http
    .patch(`/study-plans/${n2}`, { startDate: `${day}T12:00:00Z` })
    .expect(200);
  expect(
    (await http.get('/dashboard/today').expect(200)).body.data.tasks,
  ).toHaveLength(1);
});

test('completed and manual time remains charged after refresh and budget edits; overrun visible', async () => {
  const { user, http } = await h.login('spent-budget');
  await http.post('/study-plans', planInput()).expect(201);
  const session = await h.prisma.studySession.create({
    data: {
      userId: user.id,
      grammarId: 'f-N1-29',
      mode: 'PRACTICE',
      status: 'COMPLETED',
      activeSeconds: 1200,
      timerPhaseEndsAt: new Date(),
    },
  });
  await h.prisma.studyActivityDay.create({
    data: {
      userId: user.id,
      sessionId: session.id,
      studyDate: new Date(day),
      activeSeconds: 1200,
    },
  });
  // Five minutes migrated legacy time plus twenty minutes from the new ledger.
  await h.prisma.dailyStudyStat.create({
    data: { userId: user.id, studyDate: new Date(day), studyMinutes: 25 },
  });
  for (let i = 0; i < 2; i++) {
    const today = (await http.get('/dashboard/today').expect(200)).body.data;
    expect(today.allocation.spentMinutes).toBe(25);
    expect(today.estimatedMinutes).toBeLessThanOrEqual(15);
  }
  await http.put('/me/preferences', { dailyMinutes: 20 }).expect(200);
  const overrun = (await http.get('/dashboard/today').expect(200)).body.data;
  expect(overrun.allocation.overrunMinutes).toBe(5);
  expect(overrun.tasks).toEqual([]);
});

test('forecast first-day allocation matches actual shared-budget tasks and paused queue filtering', async () => {
  const { user, http } = await h.login('forecast-shared');
  const n1 = (await http.post('/study-plans', planInput()).expect(201)).body
    .data.id;
  const n2 = (await http.post('/study-plans', planInput('N2')).expect(201)).body
    .data.id;
  await due(user.id, 'N1', 2);
  await due(user.id, 'N2', 8);
  const today = (await http.get('/dashboard/today').expect(200)).body.data;
  for (const [level, id] of [
    ['N1', n1],
    ['N2', n2],
  ]) {
    const forecast = (
      await http.get(`/study-plans/${String(id)}/forecast?days=7`).expect(200)
    ).body;
    const actual = today.tasks.filter(
      (t: { grammar: { level: string } }) => t.grammar.level === level,
    );
    expect(forecast.meta.isEstimate).toBe(true);
    expect(forecast.data[0].reviewCount).toBe(
      actual.filter((t: { type: string }) => t.type === 'REVIEW').length,
    );
    expect(forecast.data[0].newCount).toBe(
      actual.filter((t: { type: string }) => t.type === 'LEARN').length,
    );
  }
  expect((await http.get('/review-queue').expect(200)).body.data).toHaveLength(
    10,
  );
  expect(
    (await http.get('/review-queue?level=N2').expect(200)).body.data,
  ).toHaveLength(8);
  await http
    .patch(`/study-plans/${String(n2)}`, { status: 'PAUSED' })
    .expect(200);
  expect((await http.get('/review-queue').expect(200)).body.data).toHaveLength(
    2,
  );
  expect(
    (await http.get('/review-queue?scope=all').expect(200)).body.data,
  ).toHaveLength(10);
});
