/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest JSON bodies are deliberately validated by runtime assertions. */
import { startHarness, type Harness } from './harness';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
const row = {
  kind: 'VOCABULARY',
  word: '生物',
  reading: 'せいぶつ',
  gloss: '生物',
  level: 'N2',
  levelSource: 'F synthetic reference',
};
const document = (rows = [row]) => ({
  fileName: 'fixture.txt',
  sourceName: 'F fixture',
  sourceVersion: '1',
  rows,
});
const validation = {
  status: 'VALIDATED',
  note: 'Synthetic fixture checked against test source',
  checkedAgainstSource: true,
};

test('private import duplicate formats retain readings and senses; validated data stays private', async () => {
  const { user, http } = await h.login('content-owner');
  const other = await h.login('content-other');
  const rows = [
    row,
    { ...row, reading: 'なまもの', gloss: '生鲜食物' },
    { ...row, gloss: '生命体' },
  ];
  const preview = (
    await http.post('/content-imports/preview', document(rows)).expect(201)
  ).body.data;
  expect(preview.inserted).toBe(3);
  const repeated = (
    await http
      .post('/content-imports/preview', {
        ...document([...rows].reverse()),
        fileName: 'fixture.pdf',
      })
      .expect(201)
  ).body.data;
  expect(repeated.id).toBe(preview.id);
  expect(repeated.inserted).toBe(0);
  expect((await http.get('/vocabulary').expect(200)).body.data).toHaveLength(0);
  await other.http.get(`/content-imports/${preview.id}`).expect(404);
  await other.http.post(`/content-imports/${preview.id}/commit`).expect(404);
  const detail = (await http.get(`/content-imports/${preview.id}`).expect(200))
    .body.data;
  for (const candidate of detail.candidates) {
    await other.http
      .patch(`/content-candidates/${candidate.id}/validation`, validation)
      .expect(404);
    await http
      .patch(`/content-candidates/${candidate.id}/validation`, validation)
      .expect(200);
  }
  const commits = await Promise.all([
    http.post(`/content-imports/${preview.id}/commit`).expect(201),
    http.post(`/content-imports/${preview.id}/commit`).expect(201),
  ]);
  expect(commits.every((c) => c.body.data.vocabularyCount === 3)).toBe(true);
  expect(
    await h.prisma.vocabularyEntry.count({ where: { ownerId: user.id } }),
  ).toBe(3);
  expect(
    await h.prisma.vocabularyEntry.count({ where: { ownerId: null } }),
  ).toBe(0);
  const mine = (await http.get('/vocabulary').expect(200)).body.data;
  expect(mine).toHaveLength(3);
  expect(
    (await other.http.get(`/vocabulary?cursor=${mine[0].id}`).expect(200)).body
      .data,
  ).toEqual([]);
  for (const entry of mine) {
    await other.http.get(`/vocabulary/${entry.id}`).expect(404);
    await other.http
      .put(`/vocabulary/${entry.id}/bookmark`, { note: 'not owner' })
      .expect(404);
  }
  await http
    .put(`/vocabulary/${mine[0].id}/bookmark`, { note: 'private note' })
    .expect(200);
  expect(
    (await other.http.get('/vocabulary/bookmarks').expect(200)).body.data,
  ).toEqual([]);
  await http
    .patch(`/content-candidates/${detail.candidates[0].id}/validation`, {
      ...validation,
      status: 'REJECTED',
    })
    .expect(200);
  expect((await http.get('/vocabulary').expect(200)).body.data).toHaveLength(2);
});

test('garbage and unverifiable level cannot be validated or published; unknown labels rejected', async () => {
  const { http } = await h.login('content-invalid');
  const badRows = [
    { ...row, word: '�生物' },
    { ...row, reading: 'ABC' },
    { ...row, levelSource: '' },
  ];
  const preview = (
    await http.post('/content-imports/preview', document(badRows)).expect(201)
  ).body.data;
  const detail = (await http.get(`/content-imports/${preview.id}`).expect(200))
    .body.data;
  for (const candidate of detail.candidates)
    await http
      .patch(`/content-candidates/${candidate.id}/validation`, validation)
      .expect(400);
  const commit = (
    await http.post(`/content-imports/${preview.id}/commit`).expect(201)
  ).body.data;
  expect(commit.vocabularyCount).toBe(0);
  await http
    .post('/content-imports/preview', document([{ ...row, level: 'UNKNOWN' }]))
    .expect(400);
});

test('200KB authenticated import accepted by production-equivalent 2MB parser with pagination privacy', async () => {
  const { http } = await h.login('content-large');
  const other = await h.login('content-large-other');
  const payload = document(
    Array.from({ length: 160 }, (_, i) => ({
      ...row,
      gloss: `释义${i}${'语'.repeat(500)}`,
    })),
  );
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeGreaterThan(200_000);
  const preview = (
    await http.post('/content-imports/preview', payload).expect(201)
  ).body.data;
  expect(preview.inserted).toBe(160);
  const first = (
    await http.get(`/content-imports/${preview.id}?limit=100`).expect(200)
  ).body.data;
  expect(first.candidates).toHaveLength(100);
  const second = (
    await http
      .get(
        `/content-imports/${preview.id}?limit=100&cursor=${first.nextCursor}`,
      )
      .expect(200)
  ).body.data;
  expect(second.candidates).toHaveLength(60);
  expect(
    new Set(
      [...first.candidates, ...second.candidates].map(
        (c: { id: string }) => c.id,
      ),
    ).size,
  ).toBe(160);
  await other.http
    .get(`/content-imports/${preview.id}?cursor=${first.nextCursor}`)
    .expect(404);
});

test('only completed checked review job IDs can create expressions; originals/private notes are isolated', async () => {
  const { user, http } = await h.login('expression-owner');
  const other = await h.login('expression-other');
  const session = await h.prisma.studySession.create({
    data: {
      userId: user.id,
      grammarId: 'f-N1-0',
      mode: 'PRACTICE',
      timerPhaseEndsAt: new Date(),
    },
  });
  const attempt = await h.prisma.sentenceAttempt.create({
    data: {
      userId: user.id,
      grammarId: 'f-N1-0',
      studySessionId: session.id,
      source: 'FREE_PRACTICE',
      sentence: 'おんがくをききながらあるく。',
    },
  });
  const job = await h.prisma.aiReviewJob.create({
    data: { attemptId: attempt.id, status: 'COMPLETED', provider: 'GEMINI' },
  });
  await h.prisma.aiReviewResult.create({
    data: {
      jobId: job.id,
      provider: 'GEMINI',
      model: 'fixture',
      promptVersion: 'fixture-v1',
      totalScore: 90,
      grammarScore: 30,
      connectionScore: 20,
      completenessScore: 20,
      naturalnessScore: 15,
      vocabularyScore: 5,
      isCorrect: true,
      usedTargetGrammar: true,
      targetGrammarCorrect: true,
      resultLevel: 'CORRECT',
      errorSpans: [],
      correctedSentence: attempt.sentence,
      correctedSentenceFurigana: attempt.sentence,
      correctedSentenceTranslationZh: '边听音乐边走路。',
      explanationZh: '测试',
      encouragement: '测试',
      latencyMs: 0,
    },
  });
  await other.http
    .post('/expressions', { reviewId: job.id, variant: 'ORIGINAL' })
    .expect(404);
  const saved = (
    await http
      .post('/expressions', {
        reviewId: job.id,
        variant: 'ORIGINAL',
        note: 'My private expression',
      })
      .expect(201)
  ).body.data;
  expect(
    (
      await http
        .post('/expressions', { reviewId: job.id, variant: 'ORIGINAL' })
        .expect(201)
    ).body.data.id,
  ).toBe(saved.id);
  expect(
    (await other.http.get(`/expressions?cursor=${saved.id}`).expect(200)).body
      .data,
  ).toEqual([]);
  await other.http
    .patch(`/expressions/${saved.id}`, { note: 'changed' })
    .expect(404);
  await other.http.delete(`/expressions/${saved.id}`).expect(404);
  expect(await h.prisma.reviewEvent.count({ where: { userId: user.id } })).toBe(
    0,
  );
  await h.prisma.aiReviewResult.update({
    where: { jobId: job.id },
    data: { isCorrect: false, targetGrammarCorrect: false },
  });
  await http
    .post('/expressions', { reviewId: job.id, variant: 'ORIGINAL' })
    .expect(400);
});
