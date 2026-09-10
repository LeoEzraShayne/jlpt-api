import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});

test('only admins can enable a selected account, metrics run on real PostgreSQL', async () => {
  const admin = await h.login('rollout-admin');
  const learner = await h.login('rollout-learner');
  await h.prisma.user.update({
    where: { id: admin.user.id },
    data: { role: 'ADMIN' },
  });
  await h.prisma.user.update({
    where: { id: learner.user.id },
    data: { learningV2Enabled: false },
  });
  await h.http().get('/admin/learning-v2/metrics').expect(401);
  await learner.http.get('/admin/learning-v2/metrics').expect(403);
  await learner.http
    .patch(`/admin/learning-v2/users/${learner.user.id}`, { enabled: true })
    .expect(403);
  await admin.http
    .patch('/admin/learning-v2/users/missing', { enabled: true })
    .expect(404);
  await admin.http
    .patch(`/admin/learning-v2/users/${learner.user.id}`, { enabled: true })
    .expect(200);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: learner.user.id } }))
      .learningV2Enabled,
  ).toBe(true);
  await admin.http.get('/admin/learning-v2/metrics?days=0').expect(400);
  const response = await admin.http
    .get('/admin/learning-v2/metrics?days=7')
    .expect(200);
  expect(response.body).toMatchObject({
    data: {
      days: 7,
      enabledAccounts: 2,
      duplicateOpenReviews: 0,
      dailyBudgetOverrunAccounts: 0,
      targetEvidenceMismatchCount: 0,
      invalidTransferEvidenceCount: 0,
      memoryImprovementValidated: false,
      latencyMs: { p50: null, p95: null },
      tokenUsage: { input: 0, output: 0 },
    },
  });
  await admin.http
    .patch(`/admin/learning-v2/users/${learner.user.id}`, { enabled: false })
    .expect(200);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: learner.user.id } }))
      .learningV2Enabled,
  ).toBe(false);
});
