import { startHarness, type Harness } from './harness';
let h: Harness;
beforeAll(async () => {
  h = await startHarness(async (db) => {
    await db.query(`
      INSERT INTO "User" (id,email,"displayName","targetLevel","updatedAt") VALUES
      ('f-migrate-active','active@example.test','Active','N1','2026-09-01'),
      ('f-migrate-paused','paused@example.test','Paused','N2','2026-09-01'),
      ('f-migrate-new','new@example.test','New','N1','2026-09-01');
      INSERT INTO "StudyPlan" (id,"userId",level,"startDate","targetDate","dailyMinutes","dailyNewLimit",status,"updatedAt") VALUES
      ('f-old-active','f-migrate-active','N1','2026-09-10T12:00:00Z','2026-12-01T12:00:00Z',20,2,'ACTIVE','2026-08-01'),
      ('f-old-recent-paused','f-migrate-active','N1','2026-09-10T12:00:00Z','2026-12-01T12:00:00Z',45,2,'PAUSED','2026-09-09'),
      ('f-old-paused-a','f-migrate-paused','N2','2026-09-10T12:00:00Z','2026-12-01T12:00:00Z',30,2,'PAUSED','2026-08-01'),
      ('f-old-paused-b','f-migrate-paused','N2','2026-09-10T12:00:00Z','2026-12-01T12:00:00Z',35,2,'PAUSED','2026-09-01');
      INSERT INTO "GrammarPoint" (id,level,title,"chineseExplanation","sortOrder","sourceDataset","sourceOrdinal","sourceHash","updatedAt") VALUES
      ('f-legacy-g','N1','ながら','一边',1,'f-legacy',1,'f-legacy-g','2026-09-01');
      INSERT INTO "UserGrammarProgress" (id,"userId","grammarId",status,"reviewCount","updatedAt") VALUES
      ('f-legacy-p','f-migrate-active','f-legacy-g','MASTERED',9,'2026-09-01');
      INSERT INTO "StudyTask" (id,"userId","planId","progressId","grammarId","taskDate",type,status,"idempotencyKey") VALUES
      ('f-open-old','f-migrate-active','f-old-active',NULL,'f-legacy-g','2026-09-01','REVIEW','PENDING','f-open-old'),
      ('f-open-running','f-migrate-active','f-old-active','f-legacy-p','f-legacy-g','2026-09-02','REVIEW','IN_PROGRESS','f-open-running');
      INSERT INTO "StudySession" (id,"userId","grammarId","taskId",mode,status,"timerPhaseEndsAt") VALUES
      ('f-running-session','f-migrate-active','f-legacy-g','f-open-running','REVIEW','ACTIVE','2026-09-01');
    `);
  });
});
afterAll(async () => {
  await h?.stop();
});

test('migration keeps active ahead of newer pause, uses original current budget, preserves in-progress duplicate history', async () => {
  const plans = await h.prisma.studyPlan.findMany({
    where: { userId: 'f-migrate-active' },
    orderBy: { id: 'asc' },
  });
  expect(plans.find((p) => p.id === 'f-old-active')?.status).toBe('ACTIVE');
  expect(plans.find((p) => p.id === 'f-old-recent-paused')?.status).toBe(
    'ARCHIVED',
  );
  const user = await h.prisma.user.findUniqueOrThrow({
    where: { id: 'f-migrate-active' },
  });
  expect(user.dailyMinutes).toBe(45);
  expect(user.learningV2Enabled).toBe(false);
  expect(
    plans.every(
      (p) => p.startDate.toISOString() === '2026-09-10T00:00:00.000Z',
    ),
  ).toBe(true);
  const tasks = await h.prisma.studyTask.findMany({
    where: { userId: user.id },
  });
  expect(tasks).toHaveLength(2);
  expect(tasks.find((t) => t.id === 'f-open-running')?.status).toBe(
    'IN_PROGRESS',
  );
  expect(tasks.find((t) => t.id === 'f-open-old')?.status).toBe('SKIPPED');
  expect(
    (
      await h.prisma.studySession.findUniqueOrThrow({
        where: { id: 'f-running-session' },
      })
    ).taskId,
  ).toBe('f-open-running');
  const progress = await h.prisma.userGrammarProgress.findUniqueOrThrow({
    where: { id: 'f-legacy-p' },
  });
  expect(progress.status).toBe('MASTERED');
  expect(progress.masteryRuleVersion).toBe('legacy-v1');
  expect(await h.prisma.reviewEvent.count({ where: { userId: user.id } })).toBe(
    0,
  );
});

test('paused-only migration retains newest pause without resuming; fresh user retains default budget', async () => {
  const plans = await h.prisma.studyPlan.findMany({
    where: { userId: 'f-migrate-paused' },
  });
  expect(plans.find((p) => p.id === 'f-old-paused-a')?.status).toBe('ARCHIVED');
  expect(plans.find((p) => p.id === 'f-old-paused-b')?.status).toBe('PAUSED');
  expect(
    (
      await h.prisma.user.findUniqueOrThrow({
        where: { id: 'f-migrate-paused' },
      })
    ).dailyMinutes,
  ).toBe(35);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: 'f-migrate-new' } }))
      .dailyMinutes,
  ).toBe(30);
  expect(
    await h.prisma.studyTask.count({ where: { userId: 'f-migrate-paused' } }),
  ).toBe(0);
});
