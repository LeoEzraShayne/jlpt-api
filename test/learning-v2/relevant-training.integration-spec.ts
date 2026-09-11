/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP payloads are verified by assertions. */
import { startHarness, type Harness } from './harness';
import { PRACTICE_SELECTION_VERSION } from '../../src/scenes/grammar-practice-catalog';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.prisma.grammarPoint.update({
    where: { id: 'f-N1-0' },
    data: {
      title: '～かたがた',
      chineseExplanation: '兼……；顺便……。常用于拜访、问候等正式场合。',
    },
  });
});
afterAll(async () => {
  await h?.stop();
});

test('refresh upgrades only unsubmitted active legacy tasks, keeps grading/hints/history and stable new task', async () => {
  const { user, http } = await h.login('relevant-refresh');
  const legacy = {
    version: 'training-v1',
    instructionZh: '旧任务',
    scenario: null,
    words: [
      {
        id: 'wrong',
        word: '跳ぶ',
        reading: 'とぶ',
        chineseGloss: null,
        glosses: [],
        sourceName: 'test',
        sourceVersion: '1',
      },
    ],
    supportingGrammar: null,
    expressions: [],
    phrases: [],
  };
  const session = await h.prisma.studySession.create({
    data: {
      userId: user.id,
      grammarId: 'f-N1-0',
      mode: 'REVIEW',
      timerPhaseEndsAt: new Date(),
      hintRevealCount: 2,
      trainingContext: legacy,
    },
  });
  const stranger = await h.login('relevant-stranger');
  await stranger.http.get(`/study-sessions/${session.id}`).expect(404);
  const [first, second] = await Promise.all([
    http.get(`/study-sessions/${session.id}`).expect(200),
    http.get(`/study-sessions/${session.id}`).expect(200),
  ]);
  for (const response of [first, second]) {
    expect(response.body.data.trainingContext.selectionVersion).toBe(
      PRACTICE_SELECTION_VERSION,
    );
    expect(response.body.data.trainingContext.scenario.promptZh).toContain(
      '拜访',
    );
    expect(response.body.data.trainingContext.words).toEqual([]);
    expect(response.body.data.hintRevealCount).toBe(2);
  }
  expect(first.body.data.scenarioId).toBe(second.body.data.scenarioId);
  const next = (await http.get(`/study-sessions/${session.id}`).expect(200))
    .body.data;
  expect(next.trainingContext).toEqual(first.body.data.trainingContext);
  expect(await h.prisma.reviewEvent.count({ where: { userId: user.id } })).toBe(
    0,
  );
  for (const status of ['ACTIVE', 'COMPLETED'] as const) {
    const old = await h.prisma.studySession.create({
      data: {
        userId: user.id,
        grammarId: 'f-N1-0',
        mode: 'PRACTICE',
        status,
        timerPhaseEndsAt: new Date(),
        trainingContext: legacy,
      },
    });
    if (status === 'ACTIVE')
      await h.prisma.sentenceAttempt.create({
        data: {
          userId: user.id,
          grammarId: 'f-N1-0',
          studySessionId: old.id,
          sentence: '旧答案',
          source: 'FREE_PRACTICE',
        },
      });
    await http.get(`/study-sessions/${old.id}`).expect(200);
    expect(
      (await h.prisma.studySession.findUniqueOrThrow({ where: { id: old.id } }))
        .trainingContext,
    ).toEqual(legacy);
  }
});

test('unmapped grammar receives no arbitrary generic scenario or words', async () => {
  const { http } = await h.login('relevant-no-profile');
  const result = (
    await http
      .post('/study-sessions', { grammarId: 'f-N1-1', mode: 'PRACTICE' })
      .expect(201)
  ).body.data.session;
  expect(result.scenarioId).toBeNull();
  expect(result.trainingContext.words).toEqual([]);
  expect(result.trainingContext.instructionZh).toContain('真实或熟悉');
});
