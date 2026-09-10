/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest JSON bodies are deliberately validated by runtime assertions. */
import { startHarness, type Harness } from './harness';
import { freezeDate, reviewSession } from './review-fixtures';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterEach(() => jest.useRealTimers());
afterAll(async () => {
  await h?.stop();
});

test('overlapping devices and repeated heartbeat count each elapsed second only once', async () => {
  const { user, http } = await h.login('activity-devices');
  freezeDate(new Date());
  const sessions = await Promise.all([
    reviewSession(h, user.id),
    reviewSession(h, user.id),
  ]);
  for (const s of sessions)
    await h.prisma.studySession.update({
      where: { id: s.id },
      data: { lastActivityAt: new Date(Date.now() - 60000) },
    });
  await Promise.all(
    sessions.flatMap((s) => [
      http.post(`/study-sessions/${s.id}/activity`).expect(201),
      http.post(`/study-sessions/${s.id}/activity`).expect(201),
    ]),
  );
  const ledger = await h.prisma.studyActivityDay.aggregate({
    where: { userId: user.id },
    _sum: { activeSeconds: true },
  });
  expect(ledger._sum.activeSeconds).toBe(60);
  const stats = await h.prisma.dailyStudyStat.findMany({
    where: { userId: user.id },
  });
  expect(stats).toHaveLength(1);
  expect(stats[0].studyMinutes).toBe(1);
  const today = (await http.get('/dashboard/today').expect(200)).body.data;
  expect(today.allocation.spentMinutes).toBe(1);
  expect(today.allocation.reservedMinutes).toBe(7);
});

test('heartbeat crossing local midnight splits 30+30 seconds, and refresh spends only today', async () => {
  freezeDate(new Date('2026-09-10T15:00:30Z'));
  const { user, http } = await h.login('activity-midnight');
  const session = await reviewSession(h, user.id);
  await h.prisma.studySession.update({
    where: { id: session.id },
    data: {
      createdAt: new Date(Date.now() - 60000),
      lastActivityAt: new Date(Date.now() - 60000),
      activeSeconds: 1200,
    },
  });
  await Promise.all([
    http.post(`/study-sessions/${session.id}/activity`).expect(201),
    http.post(`/study-sessions/${session.id}/activity`).expect(201),
  ]);
  const ledger = await h.prisma.studyActivityDay.findMany({
    where: { userId: user.id },
    orderBy: { studyDate: 'asc' },
  });
  expect(
    ledger.map((d) => [
      d.studyDate.toISOString().slice(0, 10),
      d.activeSeconds,
    ]),
  ).toEqual([
    ['2026-09-10', 30],
    ['2026-09-11', 30],
  ]);
  const today = (await http.get('/dashboard/today').expect(200)).body.data;
  expect(today.allocation.spentMinutes).toBe(0.5);
  expect(today.allocation.reservedMinutes).toBe(0);
  const stranger = await h.login('activity-midnight-stranger');
  await stranger.http
    .post(`/study-sessions/${session.id}/activity`)
    .expect(404);
});
