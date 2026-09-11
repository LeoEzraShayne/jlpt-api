/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- HTTP fixtures are checked by runtime assertions. */
import { startHarness, type Harness } from './harness';
import { AiWorkerService } from '../../src/ai/ai-worker.service';
import { claimReview } from '../../src/ai/review-job-lease';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
const coreResult = {
  total_score: 100,
  grammar_score: 30,
  connection_score: 20,
  completeness_score: 20,
  naturalness_score: 20,
  vocabulary_score: 10,
  is_correct: true,
  used_target_grammar: true,
  target_grammar_correct: true,
  result_level: 'CORRECT',
  error_spans: [],
  corrected_sentence: 'あるきながらはなします。',
  corrected_sentence_furigana: 'あるきながらはなします。',
  corrected_sentence_translation_zh: '边走边说。',
  explanation_zh: '语法正确。',
  encouragement: '继续练习。',
  scenario_task_completed: false,
};
const response = (result = coreResult) => ({
  provider: 'GEMINI',
  response: { result, model: 'test', latencyMs: 100, usage: {} },
});
function workers() {
  const reviews = {
    review: jest.fn().mockResolvedValue(response()),
  };
  const config = { get: () => true };
  return {
    reviews,
    core: new AiWorkerService(h.prisma, reviews as never, config as never),
  };
}
async function submit(name: string) {
  const { user, http } = await h.login(name);
  const session = (
    await http
      .post('/study-sessions', { grammarId: 'f-N1-0', mode: 'PRACTICE' })
      .expect(201)
  ).body.data;
  session.id = session.session.id;
  const { reviewId } = (
    await http
      .post('/sentence-reviews', {
        sessionId: session.id,
        sentence: coreResult.corrected_sentence,
      })
      .expect(202)
  ).body.data;
  return { user, http, session, id: String(reviewId) };
}

test('core-only review allows completion and correction bookmarks with no auxiliary call', async () => {
  const { http, session, id } = await submit('progressive-complete');
  const w = workers();
  await w.core.poll();
  const ready = (await http.get(`/sentence-reviews/${id}`).expect(200)).body
    .data;
  expect(ready).toMatchObject({
    status: 'COMPLETED',
    result: {
      totalScore: 100,
      alternativeSentence: null,
      scenarioTaskCompleted: false,
    },
  });
  expect(ready.result.recallPolicy.allowedRatings).toContain('REMEMBERED');
  await http
    .post('/expressions', { reviewId: id, variant: 'CORRECTION' })
    .expect(201);
  await http
    .post('/expressions', { reviewId: id, variant: 'ALTERNATIVE' })
    .expect(400);
  await http
    .post(`/study-sessions/${session.id}/complete`, {
      recallRating: 'REMEMBERED',
      sentenceReviewId: id,
    })
    .expect(201);
  await w.core.poll();
  expect(w.reviews.review).toHaveBeenCalledTimes(1);
  expect(w.reviews.review).toHaveBeenCalledWith(
    expect.objectContaining({ stage: 'CORE' }),
  );
  expect(await h.prisma.aiReviewResult.count({ where: { jobId: id } })).toBe(1);
  const stranger = await h.login('progressive-stranger');
  await stranger.http.get(`/sentence-reviews/${id}`).expect(404);
});

test('concurrent workers save a single core result', async () => {
  const { id } = await submit('core-concurrency');
  const one = workers();
  const two = workers();
  await Promise.all([one.core.poll(), two.core.poll()]);
  expect(await h.prisma.aiReviewResult.count({ where: { jobId: id } })).toBe(1);
  expect(
    one.reviews.review.mock.calls.length + two.reviews.review.mock.calls.length,
  ).toBe(1);
});

test('expired lease recovers after interruption and fences the old worker response', async () => {
  const { id } = await submit('progressive-recovery');
  const old = workers();
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  old.reviews.review.mockImplementation(async () => {
    started();
    await gate;
    return response();
  });
  const interrupted = old.core.poll();
  await entered;
  await h.prisma.aiReviewJob.update({
    where: { id },
    data: { lockedAt: new Date(Date.now() - 180000) },
  });
  const fresh = workers();
  fresh.reviews.review.mockResolvedValue(
    response({ ...coreResult, total_score: 90, grammar_score: 20 }),
  );
  await fresh.core.poll();
  release();
  await interrupted;
  expect(await h.prisma.aiReviewResult.count({ where: { jobId: id } })).toBe(1);
  expect(
    (await h.prisma.aiReviewResult.findUniqueOrThrow({ where: { jobId: id } }))
      .totalScore,
  ).toBe(90);
});

test('SQL claims use UTC timestamps on a non-UTC database connection', async () => {
  const { id } = await submit('progressive-timezone');
  const claim = await h.prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL TIME ZONE 'Asia/Shanghai'");
    return claimReview(tx as never);
  });
  expect(claim?.id).toBe(id);
  expect(Math.abs(claim.lockedAt.getTime() - Date.now())).toBeLessThan(3000);
  await h.prisma.aiReviewJob.update({
    where: { id },
    data: { status: 'FAILED' },
  });
});
