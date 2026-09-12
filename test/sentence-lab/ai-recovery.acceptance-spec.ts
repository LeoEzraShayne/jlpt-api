/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP identifiers are checked against real PostgreSQL rows. */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { startHarness, type Harness } from '../learning-v2/harness';
import { reviewSession } from '../learning-v2/review-fixtures';
import { QuotaService } from '../../src/billing/quota.service';
import { AiWorkerService } from '../../src/ai/ai-worker.service';
import { AiReviewService } from '../../src/ai/ai-review.service';
import { DeepSeekReviewProvider } from '../../src/ai/deepseek.provider';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
import { claimReview, type ReviewLease } from '../../src/ai/review-job-lease';
import type { ReviewProviderInput } from '../../src/ai/ai-provider';
import type { ProviderResponse } from '../../src/ai/review-schema';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  await h.prisma.billingConfig.create({
    data: { enforcementEnabled: true, enforcementAt: new Date(0) },
  });
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => h?.stop());
async function fixture() {
  const login = await h.login(`F-recovery-${randomUUID()}`),
    session = await reviewSession(h, login.user.id);
  const response = await login.http
    .post('/sentence-reviews', {
      sessionId: session.id,
      sentence: '音楽を聞くながら歩きます。',
      requestKey: randomUUID(),
    })
    .expect(202);
  const id = response.body.data.reviewId as string,
    quota = h.app.get(QuotaService);
  const expire = () =>
    h.prisma.aiReviewJob.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 180000) },
    });
  return { ...login, id, session, quota, expire };
}
const config = new ConfigService({
  AI_WORKER_ENABLED: true,
  AI_PRIMARY_PROVIDER: 'DEEPSEEK',
  DEEPSEEK_API_KEY: 'F-fake-no-network',
  GEMINI_API_KEY: '',
  DEEPSEEK_MODEL: 'deepseek-flash',
});
function worker(service: AiReviewService, quota: QuotaService) {
  return new AiWorkerService(h.prisma, service, config, undefined, quota);
}

test('free-first quota failure then paid correction records two calls but consumes one task once', async () => {
  const f = await fixture();
  const candidateConfig = new ConfigService({
    AI_WORKER_ENABLED: true,
    GEMINI_FREE_FIRST: 'true',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
    GEMINI_API_KEY: `synthetic-gemini-${randomUUID()}`,
    GEMINI_MODEL: 'gemini-3.8-flash',
    DEEPSEEK_API_KEY: 'synthetic-deepseek-no-network',
    DEEPSEEK_MODEL: 'deepseek-flash',
    DEEPSEEK_THINKING_EFFORT: 'low',
    DEEPSEEK_THINKING_SCOPE: 'grammar',
  });
  const payload = {
    total_score: 40,
    grammar_score: 10,
    connection_score: 5,
    completeness_score: 10,
    naturalness_score: 10,
    vocabulary_score: 5,
    is_correct: false,
    used_target_grammar: true,
    target_grammar_correct: false,
    result_level: 'INCORRECT',
    error_spans: [
      {
        text: '聞くながら',
        start: 3,
        end: 8,
        reason: 'ながら前面需要使用动词ます形去掉ます的形式。',
        replacement: '聞きながら',
      },
    ],
    corrected_sentence: '音楽を聞きながら歩きます。',
    corrected_sentence_furigana:
      '音楽[おんがく]を聞[き]きながら歩[ある]きます。',
    corrected_sentence_translation_zh: '我一边听音乐一边走路。',
    corrected_sentence_uses_target_grammar: true,
    explanation_zh: '聞く需要改成聞き，再接ながら。',
    encouragement: '继续练习动词的连接形式。',
    scenario_task_completed: false,
  };
  const transport = jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            details: [
              {
                violations: [
                  {
                    quotaId:
                      'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
                  },
                ],
              },
            ],
          },
        }),
        { status: 429 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          model: 'deepseek-flash',
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(payload) },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 60,
            total_tokens: 160,
            completion_tokens_details: { reasoning_tokens: 10 },
          },
        }),
      ),
    );
  const service = new AiReviewService(
    new GeminiReviewProvider(candidateConfig, h.prisma),
    new DeepSeekReviewProvider(candidateConfig, h.prisma),
    candidateConfig,
    h.prisma,
  );
  const candidateWorker = new AiWorkerService(
    h.prisma,
    service,
    candidateConfig,
    undefined,
    f.quota,
  );
  await candidateWorker.poll();
  await candidateWorker.poll();
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls[0][0]).toEqual(
    expect.stringContaining('generativelanguage.googleapis.com'),
  );
  expect(transport.mock.calls[1][0]).toEqual(
    expect.stringContaining('api.deepseek.com'),
  );
  const receipts = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey: f.session.id },
    orderBy: { attempt: 'asc' },
  });
  expect(receipts.map((r) => [r.provider, r.attempt, r.success])).toEqual([
    ['GEMINI', 1, false],
    ['DEEPSEEK', 2, true],
  ]);
  expect(receipts[0]).toMatchObject({
    costUsd: null,
    usageComplete: false,
    errorCode: 'AI_HTTP_429',
  });
  expect(receipts[1]).toMatchObject({
    thinkingTokens: 10,
    outputTokens: 60,
    usageComplete: true,
  });
  expect(Number(receipts[1].costUsd)).toBeGreaterThan(0);
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 1,
    remaining: 4,
  });
  expect(await h.prisma.aiReviewResult.count({ where: { jobId: f.id } })).toBe(
    1,
  );
  expect(
    await h.prisma.taskSubmission.count({
      where: { userId: f.user.id, status: 'SUCCEEDED' },
    }),
  ).toBe(1);
});

test('six concurrent manual retries admit one final round, then release quota without any fifth round', async () => {
  const f = await fixture();
  const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'deepseek-flash',
          choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 10,
            total_tokens: 110,
          },
        }),
        { status: 200 },
      ),
    ),
  );
  const service = new AiReviewService(
    new GeminiReviewProvider(config, h.prisma),
    new DeepSeekReviewProvider(config, h.prisma),
    config,
  );
  for (let i = 0; i < 3; i++) {
    await claimReview(h.prisma);
    await f.expire();
  }
  await worker(service, f.quota).poll();
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 0,
    remaining: 5,
  });
  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      f.http.post(`/sentence-reviews/${f.id}/retry`),
    ),
  );
  expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
  expect(responses.every((r) => [201, 400, 409].includes(r.status))).toBe(true);
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 1,
    consumed: 0,
  });
  await Promise.all([
    worker(service, f.quota).poll(),
    worker(service, f.quota).poll(),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const receipts = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey: f.session.id },
    orderBy: { attempt: 'asc' },
  });
  expect(receipts.map((r) => [r.attempt, r.success])).toEqual([
    [7, false],
    [8, false],
  ]);
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: f.id } }),
  ).toMatchObject({ status: 'FAILED', retryCount: 4 });
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 0,
    remaining: 5,
  });
  await f.http.post(`/sentence-reviews/${f.id}/retry`).expect(400);
  await worker(service, f.quota).poll();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    await h.prisma.taskSubmission.count({ where: { resultId: f.id } }),
  ).toBe(1);
  expect(await h.prisma.aiReviewResult.count({ where: { jobId: f.id } })).toBe(
    0,
  );
});

test('late old claimant cannot overwrite a newer result or spend quota twice', async () => {
  const f = await fixture();
  let resolveOld!: (value: {
    provider: 'DEEPSEEK';
    response: ProviderResponse;
  }) => void;
  const old = new Promise<{ provider: 'DEEPSEEK'; response: ProviderResponse }>(
    (resolve) => {
      resolveOld = resolve;
    },
  );
  const body = {
    total_score: 40,
    grammar_score: 10,
    connection_score: 5,
    completeness_score: 10,
    naturalness_score: 10,
    vocabulary_score: 5,
    is_correct: false,
    used_target_grammar: true,
    target_grammar_correct: false,
    result_level: 'INCORRECT' as const,
    error_spans: [],
    corrected_sentence: '音楽を聞きながら歩きます。',
    corrected_sentence_furigana:
      '音楽[おんがく]を聞[き]きながら歩[ある]きます。',
    corrected_sentence_translation_zh: '一边听音乐一边走。',
    corrected_sentence_uses_target_grammar: true as const,
    explanation_zh: '需要修正接续。',
    encouragement: '继续练习。',
    scenario_task_completed: false,
  };
  const response = {
    provider: 'DEEPSEEK' as const,
    response: { result: body, model: 'F-controlled', latencyMs: 0, usage: {} },
  };
  const review = jest
    .fn<
      Promise<{ provider: 'DEEPSEEK'; response: ProviderResponse }>,
      [ReviewProviderInput]
    >()
    .mockImplementationOnce(() => old)
    .mockResolvedValueOnce(response);
  const w = worker({ review } as unknown as AiReviewService, f.quota);
  const process = (lease: ReviewLease) =>
    (w as unknown as { process(lease: ReviewLease): Promise<void> }).process(
      lease,
    );
  const first = await claimReview(h.prisma);
  const pending = process(first);
  // Wait only until the controlled service has admitted the original request.
  for (let i = 0; i < 100 && !review.mock.calls.length; i++)
    await new Promise((r) => setTimeout(r, 1));
  expect(review).toHaveBeenCalledTimes(1);
  await f.expire();
  const second = await claimReview(h.prisma);
  await process(second);
  expect(
    review.mock.calls.map(([input]) => input.usageContext?.attempt),
  ).toEqual([1, 3]);
  resolveOld({
    ...response,
    response: {
      ...response.response,
      result: {
        ...body,
        total_score: 100,
        is_correct: true,
        target_grammar_correct: true,
      },
    },
  });
  await pending;
  const results = await h.prisma.aiReviewResult.findMany({
    where: { jobId: f.id },
  });
  expect(results).toHaveLength(1);
  expect(results[0].totalScore).toBe(40);
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: f.id } }),
  ).toMatchObject({ status: 'COMPLETED', retryCount: 2 });
  expect((await f.quota.summary(f.user.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 1,
    remaining: 4,
  });
  const submission = await h.prisma.taskSubmission.findFirstOrThrow({
    where: { resultId: f.id },
  });
  expect(submission.status).toBe('SUCCEEDED');
});
