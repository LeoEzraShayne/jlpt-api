/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- Supertest responses are independently checked against persisted records. */
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from '../learning-v2/harness';
import {
  existingProgress,
  reviewSession,
} from '../learning-v2/review-fixtures';
import { VocabularyAiService } from '../../src/vocabulary-learning/vocabulary-ai.service';
import { VocabularyPracticeWorker } from '../../src/vocabulary-learning/vocabulary-practice.worker';
import { AiWorkerService } from '../../src/ai/ai-worker.service';
import { QuotaService } from '../../src/billing/quota.service';
let h: Harness;
const challenge = {
  promptZh: '向负责人说明会汇报结果。',
  meaningHintZh: '把结果告诉别人。',
  grammarId: null,
  referenceSentence: '結果を報告します。',
  referenceFurigana: '結果[けっか]を報告[ほうこく]します。',
  referenceTranslationZh: '我会汇报结果。',
  chunks: ['結果を', '報告', 'します。'],
};
const assessment = {
  usedTarget: true,
  targetCorrect: true,
  meaningCorrect: true,
  readingCorrect: null,
  explanationZh: '词义使用正确。',
  corrections: [],
  correctedSentence: challenge.referenceSentence,
  correctedFurigana: challenge.referenceFurigana,
  correctedTranslationZh: challenge.referenceTranslationZh,
};
beforeAll(async () => {
  h = await startHarness();
  await h.prisma.billingConfig.create({
    data: {
      id: 'default',
      enforcementEnabled: true,
      enforcementAt: new Date(0),
    },
  });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await h?.stop();
});

test('vocabulary corrections persist three answers but first assessment and FSRS evidence remain unchanged', async () => {
  const u = await h.login(`f-evidence-${randomUUID()}`);
  const ai = h.app.get(VocabularyAiService);
  const worker = h.app.get(VocabularyPracticeWorker);
  jest.spyOn(ai, 'generate').mockResolvedValue(challenge);
  const assess = jest.spyOn(ai, 'assess').mockResolvedValue(assessment);
  const word = await h.prisma.vocabularyEntry.create({
    data: {
      fingerprint: randomUUID(),
      word: '報告',
      reading: 'ほうこく',
      senseKey: 'report',
      partOfSpeech: ['noun'],
      glosses: [{ language: 'eng', text: 'report' }],
      chineseGloss: '报告',
      chineseGlossSource: 'F original fixture',
      sourceName: 'F fixture',
      sourceVersion: '1',
      provenance: {},
      validationStatus: 'VALIDATED',
    },
  });
  await u.http
    .patch(`/vocabulary/${word.id}/learning`, { action: 'PRACTICE' })
    .expect(200);
  const id = (
    await u.http
      .post('/vocabulary-practices', { vocabularyId: word.id })
      .expect(201)
  ).body.data.id as string;
  await worker.processOne();
  const answer = (sentence: string, requestKey = randomUUID()) =>
    u.http.post(`/vocabulary-practices/${id}/answer`, { sentence, requestKey });
  const key = randomUUID();
  await Promise.all([
    answer('結果を報告します。', key).expect(201),
    answer('結果を報告します。', key).expect(201),
  ]);
  await worker.processOne();
  const first = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id },
  });
  const memory = await h.prisma.vocabularyLearning.findUniqueOrThrow({
    where: { id: first.learningId },
  });
  expect(first.counted).toBe(true);
  expect(memory.memoryCard).not.toBeNull();
  assess.mockResolvedValue({
    ...assessment,
    targetCorrect: false,
    meaningCorrect: false,
    explanationZh: '后续错误仅用于纠正。',
  });
  for (const sentence of ['内容を報告です。', '結果が報告です。']) {
    await answer(sentence).expect(201);
    await worker.processOne();
  }
  expect(
    await h.prisma.vocabularyPracticeAttempt.count({
      where: { practiceId: id, status: 'COMPLETED' },
    }),
  ).toBe(3);
  expect(assess).toHaveBeenCalledTimes(3);
  const final = await h.prisma.vocabularyPractice.findUniqueOrThrow({
    where: { id },
  });
  expect([
    final.answer,
    final.assessment,
    final.counted,
    final.completedAt,
  ]).toEqual([
    first.answer,
    first.assessment,
    first.counted,
    first.completedAt,
  ]);
  expect(
    await h.prisma.vocabularyLearning.findUniqueOrThrow({
      where: { id: first.learningId },
    }),
  ).toEqual(memory);
  const limited = await answer('もう一度報告します。').expect(402);
  expect(JSON.stringify(limited.body)).toContain('TASK_REVIEW_LIMIT');
  const foreign = await h.login(`f-evidence-foreign-${randomUUID()}`);
  await foreign.http
    .post(`/vocabulary-practices/${id}/answer`, {
      sentence: '結果を報告します。',
      requestKey: key,
    })
    .expect(404);
  expect(
    (await h.app.get(QuotaService).summary(u.user.id)).quota.consumed,
  ).toBe(1);
  expect(
    await h.prisma.vocabularyEntry.findUniqueOrThrow({
      where: { id: word.id },
    }),
  ).toEqual(word);
});

test('grammar corrections and repeated completion create one first-attempt memory event', async () => {
  const u = await h.login(`f-grammar-evidence-${randomUUID()}`);
  const progress = await existingProgress(h, u.user.id);
  const session = await reviewSession(h, u.user.id);
  const result = {
    total_score: 50,
    grammar_score: 10,
    connection_score: 10,
    completeness_score: 10,
    naturalness_score: 10,
    vocabulary_score: 10,
    is_correct: false,
    used_target_grammar: true,
    target_grammar_correct: false,
    result_level: 'NEEDS_WORK',
    error_spans: [],
    corrected_sentence: '音楽を聞きながら歩きます。',
    corrected_sentence_furigana:
      '音楽[おんがく]を聞[き]きながら歩[ある]きます。',
    corrected_sentence_translation_zh: '一边听音乐一边走路。',
    explanation_zh: '首次存在语法问题。',
    encouragement: '继续练习。',
    scenario_task_completed: true,
  };
  const review = jest
    .fn()
    .mockResolvedValue({
      provider: 'GEMINI',
      response: { result, model: 'f-fixture', latencyMs: 1, usage: {} },
    });
  const worker = new AiWorkerService(
    h.prisma,
    { review } as never,
    { get: () => true } as never,
    undefined,
    h.app.get(QuotaService),
  );
  let firstId = '';
  let lastId = '';
  for (let i = 0; i < 3; i++) {
    const response = await u.http
      .post('/sentence-reviews', {
        sessionId: session.id,
        sentence: `音楽を聞きながら歩きます${i}。`,
        requestKey: randomUUID(),
      })
      .expect(202);
    lastId = response.body.data.reviewId as string;
    if (i === 0) firstId = lastId;
    await worker.poll();
    review.mockResolvedValue({
      provider: 'GEMINI',
      response: {
        result: {
          ...result,
          total_score: 100,
          target_grammar_correct: true,
          is_correct: true,
          result_level: 'CORRECT',
        },
        model: 'f-fixture',
        latencyMs: 1,
        usage: {},
      },
    });
  }
  const firstJob = await h.prisma.aiReviewJob.findUniqueOrThrow({
    where: { id: firstId },
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      u.http
        .post(`/study-sessions/${session.id}/complete`, {
          recallRating: 'REMEMBERED',
          sentenceReviewId: lastId,
        })
        .expect(201),
    ),
  );
  const event = await h.prisma.reviewEvent.findUniqueOrThrow({
    where: { sessionId: session.id },
  });
  expect(event).toMatchObject({
    firstAttemptId: firstJob.attemptId,
    firstScore: 50,
    effectiveRating: 'FORGOT',
  });
  expect(
    await h.prisma.reviewEvent.count({ where: { sessionId: session.id } }),
  ).toBe(1);
  expect(
    (
      await h.prisma.userGrammarProgress.findUniqueOrThrow({
        where: { id: progress.id },
      })
    ).reviewCount,
  ).toBe(progress.reviewCount + 1);
  expect(
    (await h.app.get(QuotaService).summary(u.user.id)).quota.consumed,
  ).toBe(1);
});
