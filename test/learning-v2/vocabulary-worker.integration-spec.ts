/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP fixtures use asserted public results. */
import {
  claimVocabularyPractice,
  vocabularyLeaseWhere,
} from '../../src/vocabulary-learning/vocabulary-practice.lease';
import { randomUUID } from 'node:crypto';
import { VocabularyAiService } from '../../src/vocabulary-learning/vocabulary-ai.service';
import { VocabularyPracticeWorker } from '../../src/vocabulary-learning/vocabulary-practice.worker';
import type { WordAssessment } from '../../src/vocabulary-learning/vocabulary-ai.schema';
import { startHarness, type Harness } from './harness';
let h: Harness;
let ai: VocabularyAiService;
let worker: VocabularyPracticeWorker;
const challenge = {
  promptZh: '向负责人说明你会把项目情况告诉他。',
  meaningHintZh: '把情况或结果告诉有关的人。',
  grammarId: null,
  referenceSentence: '結果を報告します。',
  referenceFurigana: '結果[けっか]を報告[ほうこく]します。',
  referenceTranslationZh: '我来汇报结果。',
  chunks: ['結果を', '報告', 'します。'],
};
const accepted: WordAssessment = {
  usedTarget: true,
  targetCorrect: true,
  meaningCorrect: true,
  readingCorrect: null,
  explanationZh: '这个词在句子中的意思和搭配正确。',
  corrections: [],
  correctedSentence: challenge.referenceSentence,
  correctedFurigana: challenge.referenceFurigana,
  correctedTranslationZh: challenge.referenceTranslationZh,
};
beforeAll(async () => {
  h = await startHarness();
  ai = h.app.get(VocabularyAiService);
  worker = h.app.get(VocabularyPracticeWorker);
});
afterAll(async () => {
  await h?.stop();
});
beforeEach(() => {
  jest.spyOn(ai, 'generate').mockResolvedValue(challenge);
  jest.spyOn(ai, 'assess').mockResolvedValue(accepted);
});
afterEach(() => {
  jest.restoreAllMocks();
});
async function fixture(action = 'PRACTICE') {
  const a = await h.login(`word-worker-${randomUUID()}`);
  const word = await h.prisma.vocabularyEntry.create({
    data: {
      ownerId: a.user.id,
      fingerprint: randomUUID(),
      word: '報告',
      reading: 'ほうこく',
      senseKey: 'report',
      partOfSpeech: [],
      glosses: [{ language: 'eng', text: 'report' }],
      chineseGloss: '报告；汇报',
      level: 'N2',
      sourceName: 'test',
      sourceVersion: '1',
      provenance: {},
      validationStatus: 'VALIDATED',
    },
  });
  await a.http.patch(`/vocabulary/${word.id}/learning`, { action }).expect(200);
  const start = async () => {
    const id = (
      await a.http
        .post('/vocabulary-practices', { vocabularyId: word.id })
        .expect(201)
    ).body.data.id as string;
    await worker.processOne();
    expect(
      (await a.http.get(`/vocabulary-practices/${id}`).expect(200)).body.data
        .status,
    ).toBe('READY');
    return id;
  };
  const answer = async (id: string) => {
    await a.http
      .post(`/vocabulary-practices/${id}/answer`, {
        sentence: '結果を報告します。',
        requestKey: randomUUID(),
      })
      .expect(201);
  };
  const learning = () =>
    h.prisma.vocabularyLearning.findUniqueOrThrow({
      where: {
        userId_vocabularyId: { userId: a.user.id, vocabularyId: word.id },
      },
    });
  return { ...a, word, start, answer, learning };
}

test('independent first due answer schedules once; early repetition cannot extend or mark grammar', async () => {
  const f = await fixture();
  const id = await f.start();
  await f.answer(id);
  await worker.processOne();
  const first = await f.learning();
  expect(first.lastOutcome).toBe('INDEPENDENT');
  expect(first.nextReviewAt!.getTime()).toBeGreaterThan(Date.now());
  expect(
    (await h.prisma.vocabularyPractice.findUniqueOrThrow({ where: { id } }))
      .counted,
  ).toBe(true);
  const repeatId = await f.start();
  await f.answer(repeatId);
  await worker.processOne();
  const repeated = await f.learning();
  expect(repeated.memoryCard).toEqual(first.memoryCard);
  expect(repeated.nextReviewAt).toEqual(first.nextReviewAt);
  expect(
    (
      await h.prisma.vocabularyPractice.findUniqueOrThrow({
        where: { id: repeatId },
      })
    ).counted,
  ).toBe(false);
  expect(
    await h.prisma.reviewEvent.count({ where: { userId: f.user.id } }),
  ).toBe(0);
});

test('hinted and initially unknown exercises never become independent word recall', async () => {
  for (const action of ['PRACTICE', 'UNKNOWN']) {
    const f = await fixture(action);
    const id = await f.start();
    if (action === 'PRACTICE')
      await f.http.post(`/vocabulary-practices/${id}/hint`).expect(201);
    else
      expect(
        (await f.http.get(`/vocabulary-practices/${id}`).expect(200)).body.data
          .learningPreview.word,
      ).toBe('報告');
    await f.answer(id);
    await worker.processOne();
    expect((await f.learning()).lastOutcome).toBe('PROMPTED');
    const result = (await f.http.get(`/vocabulary-practices/${id}`).expect(200))
      .body.data.result;
    expect(result.outcome).toBe('PROMPTED');
    expect(result.readingCorrect).toBeNull();
  }
});

test('alternate expression is unverified; same-day cherry-picked success does not extend due', async () => {
  const f = await fixture();
  const first = await f.learning();
  const id = await f.start();
  jest.spyOn(ai, 'assess').mockResolvedValueOnce({
    ...accepted,
    usedTarget: false,
    targetCorrect: null,
    meaningCorrect: null,
  });
  await f.answer(id);
  await worker.processOne();
  expect((await f.learning()).nextReviewAt).toEqual(first.nextReviewAt);
  expect((await f.learning()).lastOutcome).toBe('UNVERIFIED');
  const next = await f.start();
  await f.answer(next);
  await worker.processOne();
  expect((await f.learning()).memoryCard).toBeNull();
  expect(
    (
      await h.prisma.vocabularyPractice.findUniqueOrThrow({
        where: { id: next },
      })
    ).counted,
  ).toBe(false);
});

test('manual remembered during an AI request prevents stale completion from changing memory', async () => {
  const f = await fixture('UNKNOWN');
  const id = await f.start();
  await f.answer(id);
  let finish!: (value: WordAssessment) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  jest.spyOn(ai, 'assess').mockImplementationOnce(() => {
    entered();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const pending = worker.processOne();
  await started;
  await f.http
    .patch(`/vocabulary/${f.word.id}/learning`, { action: 'REMEMBERED' })
    .expect(200);
  finish(accepted);
  await pending;
  const learning = await f.learning();
  expect(learning).toMatchObject({
    knowledge: 'REMEMBERED',
    practiceEnabled: false,
    nextReviewAt: null,
    memoryCard: null,
  });
  const old = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id },
  });
  expect(old.status).toBe('FAILED');
  expect(old.answer).toBe('結果を報告します。');
  expect(old.counted).toBe(false);
  await f.http.post(`/vocabulary-practices/${id}/retry`).expect(409);
});

test('SQL leases use UTC under a non-UTC database session and fence expired workers', async () => {
  const f = await fixture();
  const id = (
    await f.http
      .post('/vocabulary-practices', { vocabularyId: f.word.id })
      .expect(201)
  ).body.data.id as string;
  const lease = await h.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Shanghai'");
    return claimVocabularyPractice(tx);
  });
  expect(lease?.id).toBe(id);
  expect(Math.abs(lease.lockedAt.getTime() - Date.now())).toBeLessThan(5_000);
  await h.prisma.vocabularyPractice.update({
    where: { id },
    data: { lockedAt: new Date(Date.now() - 180_000) },
  });
  const recovered = await claimVocabularyPractice(h.prisma);
  expect(recovered?.id).toBe(id);
  expect(recovered?.attempts).toBe(2);
  const staleWrite = await h.prisma.vocabularyPractice.updateMany({
    where: vocabularyLeaseWhere(lease),
    data: { status: 'READY' },
  });
  expect(staleWrite.count).toBe(0);
  await h.prisma.vocabularyPractice.update({
    where: { id },
    data: { attempts: 3, lockedAt: new Date(Date.now() - 180_000) },
  });
  expect(await claimVocabularyPractice(h.prisma)).toBeUndefined();
  expect(
    (await h.prisma.vocabularyPractice.findUniqueOrThrow({ where: { id } }))
      .status,
  ).toBe('FAILED');
});

test('failed submitted hints remain assisted on a new job and cannot create same-day success evidence', async () => {
  const f = await fixture();
  const first = await f.learning();
  const id = await f.start();
  await f.http.post(`/vocabulary-practices/${id}/hint`).expect(201);
  await f.answer(id);
  jest
    .spyOn(ai, 'assess')
    .mockRejectedValueOnce(new Error('Synthetic provider failure'));
  await worker.processOne();
  expect(
    (await h.prisma.vocabularyPractice.findUniqueOrThrow({ where: { id } }))
      .status,
  ).toBe('FAILED');
  const next = await f.start();
  await f.answer(next);
  await worker.processOne();
  const row = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id: next },
  });
  expect(row).toMatchObject({ counted: false, hintLevel: 1 });
  expect((await f.learning()).lastOutcome).toBe('PROMPTED');
  expect((await f.learning()).nextReviewAt).toEqual(first.nextReviewAt);
});

test('automatic next and due summary skip a consumed word without changing its original due date', async () => {
  const f = await fixture();
  const before = await f.learning();
  const id = await f.start();
  jest.spyOn(ai, 'assess').mockResolvedValueOnce({
    ...accepted,
    usedTarget: false,
    targetCorrect: null,
    meaningCorrect: null,
  });
  await f.answer(id);
  await worker.processOne();
  expect(
    (await f.http.get('/vocabulary-learning/summary').expect(200)).body.data
      .dueCount,
  ).toBe(0);
  expect(
    (await f.http.get('/vocabulary-learning?list=DUE').expect(200)).body.data,
  ).toEqual([]);
  await f.http.post('/vocabulary-practices').expect(404);
  const {
    id: _id,
    createdAt: _created,
    updatedAt: _updated,
    ...source
  } = f.word;
  void _id;
  void _created;
  void _updated;
  const second = await h.prisma.vocabularyEntry.create({
    data: {
      ...source,
      glosses: [],
      provenance: {},
      fingerprint: randomUUID(),
      senseKey: 'second',
    },
  });
  await f.http
    .patch(`/vocabulary/${second.id}/learning`, { action: 'PRACTICE' })
    .expect(200);
  expect(
    (await f.http.post('/vocabulary-practices').expect(201)).body.data
      .vocabularyId,
  ).toBe(second.id);
  await f.http
    .patch(`/vocabulary/${second.id}/learning`, { action: 'PAUSE' })
    .expect(200);
  expect((await f.learning()).nextReviewAt).toEqual(before.nextReviewAt);
});

test('same-task corrections preserve first evidence and consume one shared task with three successful slots', async () => {
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { enforcementEnabled: true, enforcementAt: new Date(0) },
    update: { enforcementEnabled: true, enforcementAt: new Date(0) },
  });
  const f = await fixture();
  const id = await f.start();
  await f.answer(id);
  await worker.processOne();
  const firstMemory = await f.learning();
  const first = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id },
  });
  for (let i = 0; i < 2; i++) {
    const requestKey = randomUUID();
    const body = { sentence: `結果を詳しく報告します。${i}`, requestKey };
    await f.http.post(`/vocabulary-practices/${id}/answer`, body).expect(201);
    await f.http.post(`/vocabulary-practices/${id}/answer`, body).expect(201);
    await worker.processOne();
  }
  await f.http
    .post(`/vocabulary-practices/${id}/answer`, {
      sentence: 'もう一度報告します。',
      requestKey: randomUUID(),
    })
    .expect(402);
  const current = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id },
  });
  expect(current.answer).toBe(first.answer);
  expect(current.assessment).toEqual(first.assessment);
  expect((await f.learning()).memoryCard).toEqual(firstMemory.memoryCard);
  expect((await f.learning()).nextReviewAt).toEqual(firstMemory.nextReviewAt);
  expect(
    await h.prisma.vocabularyPracticeAttempt.count({
      where: { practiceId: id, status: 'COMPLETED' },
    }),
  ).toBe(3);
  expect(
    await h.prisma.taskAuthorization.findUnique({
      where: { kind_taskKey: { kind: 'VOCABULARY', taskKey: id } },
    }),
  ).toMatchObject({
    successfulReviews: 3,
    reservedReviews: 0,
    status: 'CONSUMED',
  });
});
