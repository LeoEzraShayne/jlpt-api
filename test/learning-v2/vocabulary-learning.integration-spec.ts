/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP JSON is validated with assertions. */
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './harness';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
async function entry(ownerId: string | null = null, sense = 'report') {
  return h.prisma.vocabularyEntry.create({
    data: {
      ownerId,
      fingerprint: randomUUID(),
      word: '報告',
      reading: 'ほうこく',
      senseKey: sense,
      partOfSpeech: ['noun'],
      glosses: [{ language: 'eng', text: sense }],
      chineseGloss: '报告；汇报',
      level: 'N2',
      sourceName: 'integration fixture',
      sourceVersion: '1',
      provenance: {},
      validationStatus: 'VALIDATED',
    },
  });
}

test('manual states are per sense, authoritative, idempotent and private across search/bookmarks', async () => {
  const a = await h.login('word-state-a');
  const b = await h.login('word-state-b');
  const word = await entry();
  const otherSense = await entry(null, 'reporting');
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'PRACTICE' })
    .expect(200);
  const remembered = (
    await a.http
      .patch(`/vocabulary/${word.id}/learning`, { action: 'REMEMBERED' })
      .expect(200)
  ).body.data;
  expect(remembered).toMatchObject({
    knowledge: 'REMEMBERED',
    practiceEnabled: true,
  });
  const repeat = (
    await a.http
      .patch(`/vocabulary/${word.id}/learning`, { action: 'REMEMBERED' })
      .expect(200)
  ).body.data;
  expect(repeat.manualRevision).toBe(remembered.manualRevision);
  expect(repeat.nextReviewAt).toBe(remembered.nextReviewAt);
  expect(
    (await a.http.get(`/vocabulary/${otherSense.id}`).expect(200)).body.data
      .learning,
  ).toBeNull();
  expect(
    (await b.http.get(`/vocabulary/${word.id}`).expect(200)).body.data.learning,
  ).toBeNull();
  await a.http.put(`/vocabulary/${word.id}/bookmark`).expect(200);
  expect(
    (await a.http.get('/vocabulary/bookmarks').expect(200)).body.data[0]
      .vocabulary.learning.knowledge,
  ).toBe('REMEMBERED');
  expect(
    (await b.http.get('/vocabulary-learning').expect(200)).body.data,
  ).toEqual([]);
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'STOP_PRACTICE' })
    .expect(200);
  const stopped = (await a.http.get(`/vocabulary/${word.id}`).expect(200)).body
    .data.learning;
  expect(stopped).toMatchObject({
    knowledge: 'REMEMBERED',
    practiceEnabled: false,
    nextReviewAt: null,
  });
});

test('only manually enrolled visible senses enter daily lists, paused items resume without losing state', async () => {
  const a = await h.login('word-due-a');
  const b = await h.login('word-due-b');
  const word = await entry(a.user.id);
  const bookmarkOnly = await entry();
  await a.http.put(`/vocabulary/${bookmarkOnly.id}/bookmark`).expect(200);
  await b.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'UNKNOWN' })
    .expect(404);
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'UNKNOWN' })
    .expect(200);
  expect(
    (await a.http.get('/vocabulary-learning/summary').expect(200)).body.data,
  ).toMatchObject({ unknownCount: 1, practiceCount: 0, dueCount: 1 });
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'PAUSE' })
    .expect(200);
  expect(
    (await a.http.get('/vocabulary-learning/summary').expect(200)).body.data
      .dueCount,
  ).toBe(0);
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'RESUME' })
    .expect(200);
  expect(
    (
      (await a.http.get('/vocabulary-learning?list=DUE&level=N2').expect(200))
        .body.data as Array<{ id: string }>
    ).map((x) => x.id),
  ).toEqual([word.id]);
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'REMEMBERED' })
    .expect(200);
  expect(
    (await a.http.get('/vocabulary-learning/summary').expect(200)).body.data
      .dueCount,
  ).toBe(0);
  expect(
    await h.prisma.vocabularyLearning.count({ where: { userId: a.user.id } }),
  ).toBe(1);
});

test('concurrent enrollment and practice creation have one current record, ownership enforced', async () => {
  const a = await h.login('word-concurrent-a');
  const b = await h.login('word-concurrent-b');
  const word = await entry();
  await Promise.all(
    Array.from({ length: 4 }, () =>
      a.http
        .patch(`/vocabulary/${word.id}/learning`, { action: 'PRACTICE' })
        .expect(200),
    ),
  );
  const results = await Promise.all(
    Array.from({ length: 4 }, () =>
      a.http
        .post('/vocabulary-practices', { vocabularyId: word.id })
        .expect(201),
    ),
  );
  const id = results[0].body.data.id as string;
  expect(new Set(results.map((r) => r.body.data.id as string)).size).toBe(1);
  expect(
    await h.prisma.vocabularyPractice.count({ where: { userId: a.user.id } }),
  ).toBe(1);
  await b.http.get(`/vocabulary-practices/${id}`).expect(404);
  await b.http.post(`/vocabulary-practices/${id}/hint`).expect(404);
  await b.http
    .post(`/vocabulary-practices/${id}/answer`, {
      sentence: '報告します。',
      requestKey: randomUUID(),
    })
    .expect(404);
  await b.http
    .get(`/vocabulary/${word.id}/learning-history`)
    .expect(200)
    .then((r) => expect(r.body.data).toEqual([]));
  await a.http
    .post('/vocabulary-practices', { vocabularyId: (await entry()).id })
    .expect(404);
});

const challenge = {
  promptZh: '你已调查完项目，请向负责人说明你将汇报结果。',
  meaningHintZh: '把情况或结果告诉有关的人。',
  grammarId: null,
  referenceSentence: '結果を報告します。',
  referenceFurigana: '結果[けっか]を報告[ほうこく]します。',
  referenceTranslationZh: '我来汇报结果。',
  chunks: ['結果を', '報告', 'します。'],
};

test('READY hides target and reference until persisted hints, first answer is immutable and replay-safe', async () => {
  const a = await h.login('word-hints-a');
  const word = await entry();
  await a.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'PRACTICE' })
    .expect(200);
  const id = (
    await a.http
      .post('/vocabulary-practices', { vocabularyId: word.id })
      .expect(201)
  ).body.data.id as string;
  await h.prisma.vocabularyPractice.update({
    where: { id },
    data: { status: 'READY', challenge },
  });
  const hidden = (await a.http.get(`/vocabulary-practices/${id}`).expect(200))
    .body.data;
  expect(JSON.stringify(hidden)).not.toContain('ほうこく');
  expect(hidden.reference).toBeUndefined();
  expect(hidden.challenge).toBeUndefined();
  expect(hidden.learningPreview).toBeUndefined();
  const one = (
    await a.http.post(`/vocabulary-practices/${id}/hint`).expect(201)
  ).body.data;
  expect(one.hintLevel).toBe(1);
  expect(one.hints.word).toBeUndefined();
  expect(one.hints.meaning).toBeTruthy();
  expect(
    (await a.http.get(`/vocabulary-practices/${id}`).expect(200)).body.data
      .hintLevel,
  ).toBe(1);
  const payload = { sentence: '結果を報告します。', requestKey: randomUUID() };
  await a.http.post(`/vocabulary-practices/${id}/answer`, payload).expect(201);
  await a.http.post(`/vocabulary-practices/${id}/answer`, payload).expect(201);
  await a.http
    .post(`/vocabulary-practices/${id}/answer`, {
      ...payload,
      sentence: '変更します。',
    })
    .expect(409);
  await a.http.post(`/vocabulary-practices/${id}/hint`).expect(409);
  expect(
    (await h.prisma.vocabularyPractice.findUniqueOrThrow({ where: { id } }))
      .answer,
  ).toBe(payload.sentence);
});

test('migration keeps all legacy learning data and enforces unfinished uniqueness in PostgreSQL', async () => {
  const a = await h.login('word-db-constraint');
  const word = await entry();
  const learning = await h.prisma.vocabularyLearning.create({
    data: { userId: a.user.id, vocabularyId: word.id },
  });
  const data = {
    userId: a.user.id,
    vocabularyId: word.id,
    learningId: learning.id,
    learningRevision: 0,
    unknownAtStart: true,
    dueAtStart: true,
  };
  const first = await h.prisma.vocabularyPractice.create({ data });
  await expect(
    h.prisma.vocabularyPractice.create({ data }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await h.prisma.vocabularyPractice.update({
    where: { id: first.id },
    data: { status: 'COMPLETED' },
  });
  await h.prisma.vocabularyPractice.create({ data });
  expect(
    await h.prisma.vocabularyPractice.count({
      where: { learningId: learning.id },
    }),
  ).toBe(2);
  expect(await h.prisma.grammarPoint.count()).toBe(120);
});
