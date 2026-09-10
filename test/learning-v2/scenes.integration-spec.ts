/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument -- Supertest JSON bodies are deliberately validated by runtime assertions. */
import { startHarness, type Harness } from './harness';
import { reviewSession, reviewedAttempt } from './review-fixtures';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});

test('server assigns stable scene task and redacts personal expression on create and GET; reveal persists hint', async () => {
  const { user, http } = await h.login('scene-redaction');
  // Known valid private content fixture. Save endpoint itself is tested in content suite.
  const expression = await h.prisma.personalExpression.create({
    data: {
      userId: user.id,
      grammarId: 'f-N1-0',
      reviewId: 'synthetic-reviewed-expression',
      variant: 'ORIGINAL',
      sentence: 'ひみつのぶんをよみながらあるく。',
      provenance: { source: 'F_CHECKED_FIXTURE' },
    },
  });
  await h.prisma.trainingScenario.upsert({
    where: { id: 'f-home' },
    update: {},
    create: {
      id: 'f-home',
      domain: 'LIFE',
      objective: 'explain-routine',
      register: 'POLITE',
      promptZh: '介绍日常习惯',
      levels: ['N1', 'N2', 'N3', 'N4'],
    },
  });
  const result = (
    await http
      .post('/study-sessions', {
        grammarId: 'f-N1-0',
        mode: 'REVIEW',
        scenarioId: 'attacker-scene',
        trainingMode: 'TRANSFER',
      })
      .expect(201)
  ).body.data;
  const id = result.session.id;
  const persisted = await h.prisma.studySession.findUniqueOrThrow({
    where: { id },
  });
  expect(persisted.scenarioId).toBeTruthy();
  expect(persisted.scenarioId).not.toBe('attacker-scene');
  expect(persisted.trainingMode).toBe('UNDERSTAND');
  expect(JSON.stringify(persisted.trainingContext)).toContain(
    expression.sentence,
  );
  expect(JSON.stringify(result)).not.toContain(expression.sentence);
  expect(result.session.trainingContext.referenceHidden).toBe(true);
  const fetched = (await http.get(`/study-sessions/${id}`).expect(200)).body
    .data;
  expect(fetched.scenarioId).toBe(persisted.scenarioId);
  expect(JSON.stringify(fetched)).not.toContain(expression.sentence);
  expect(await h.prisma.reviewEvent.count({ where: { userId: user.id } })).toBe(
    0,
  );
  const revealed = (await http.post(`/study-sessions/${id}/reveal`).expect(201))
    .body.data;
  expect(JSON.stringify(revealed)).toContain(expression.sentence);
  expect(revealed.hintRevealCount).toBeGreaterThan(0);
  const stranger = await h.login('scene-stranger');
  await stranger.http.get(`/study-sessions/${id}`).expect(404);
  await stranger.http.post(`/study-sessions/${id}/reveal`).expect(404);
});

test('server progresses reuse stages, then assigns a different expression objective for transfer', async () => {
  const { http } = await h.login('scene-progression');
  await h.prisma.trainingScenario.upsert({
    where: { id: 'f-work' },
    update: {},
    create: {
      id: 'f-work',
      domain: 'WORK',
      objective: 'explain-delay',
      register: 'POLITE',
      promptZh: '向同事解释进度延期的原因',
      levels: ['N1'],
    },
  });
  const modes: string[] = [];
  const objectives: string[] = [];
  for (let i = 0; i < 5; i++) {
    const result = (
      await http
        .post('/study-sessions', { grammarId: 'f-N1-0', mode: 'PRACTICE' })
        .expect(201)
    ).body.data;
    modes.push(result.session.trainingMode);
    objectives.push(result.session.trainingContext.scenario.objectiveId);
    // Isolate assignment progression from F-001 completion defect; memory suite tests actual completion.
    await h.prisma.studySession.update({
      where: { id: result.session.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(Date.now() + i * 1000),
      },
    });
  }
  expect(modes).toEqual([
    'UNDERSTAND',
    'SUBSTITUTE',
    'SUBSTITUTE',
    'COMBINE',
    'TRANSFER',
  ]);
  expect(new Set(objectives.slice(0, 4)).size).toBe(1);
  expect(objectives[4]).not.toBe(objectives[3]);
});

test('unrevealed session GET does not expose training references through auxiliary routes', async () => {
  const { user, http } = await h.login('scene-auxiliary');
  const session = await reviewSession(h, user.id);
  // Arbitrary internal reference fields must not leak through activity or timer responses.
  await h.prisma.studySession.update({
    where: { id: session.id },
    data: { trainingContext: { secretReference: 'f-secret-reference' } },
  });
  const activity = await http
    .post(`/study-sessions/${session.id}/activity`)
    .expect(201);
  const timer = await http
    .post(`/study-sessions/${session.id}/timer/advance`)
    .expect(201);
  expect(JSON.stringify(activity.body)).not.toContain('f-secret-reference');
  expect(JSON.stringify(timer.body)).not.toContain('f-secret-reference');
  await reviewedAttempt(h, session, 80);
});
