/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP payload is checked through persisted task records. */
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { startHarness, type Harness } from '../learning-v2/harness';
import { reviewSession } from '../learning-v2/review-fixtures';
import { AiReviewService } from '../../src/ai/ai-review.service';
import { DeepSeekReviewProvider } from '../../src/ai/deepseek.provider';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
import { AiWorkerService } from '../../src/ai/ai-worker.service';
import { claimReview } from '../../src/ai/review-job-lease';
import { jobInput, reviewJobInclude } from '../../src/ai/review-job-context';
import type { ReviewProviderInput } from '../../src/ai/ai-provider';
let h: Harness;
let fetchMock: jest.SpyInstance;
beforeAll(async () => {
  h = await startHarness();
});
beforeEach(() => {
  fetchMock = jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('F_NETWORK_DISABLED'));
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => h?.stop());
const original = '勉強するたいです。';
const accepted = {
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
      text: 'するたい',
      start: 2,
      end: 6,
      reason: 'Use the verb stem before たい.',
      replacement: 'したい',
    },
  ],
  corrected_sentence: '勉強したいです。',
  corrected_sentence_furigana: '勉強[べんきょう]したいです。',
  corrected_sentence_translation_zh: 'I want to study.',
  corrected_sentence_uses_target_grammar: true,
  explanation_zh: 'Attach たい to the stem.',
  encouragement: 'Keep practicing.',
  scenario_task_completed: false,
};
function response(payload: unknown, gemini = false) {
  return new Response(
    JSON.stringify(
      gemini
        ? {
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: JSON.stringify(payload) }] },
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 50,
              totalTokenCount: 150,
            },
          }
        : {
            model: 'deepseek-flash',
            choices: [
              {
                finish_reason: 'stop',
                message: { content: JSON.stringify(payload) },
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          },
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}
function routing(extra: Record<string, unknown> = {}) {
  const config = new ConfigService({
    DEEPSEEK_API_KEY: 'F-fake-key-not-valid',
    DEEPSEEK_MODEL: 'deepseek-flash',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
    AI_WORKER_ENABLED: true,
    ...extra,
  });
  return {
    config,
    service: new AiReviewService(
      new GeminiReviewProvider(config, h.prisma),
      new DeepSeekReviewProvider(config, h.prisma),
      config,
    ),
  };
}
function input(key: string): ReviewProviderInput {
  return {
    stage: 'CORE',
    explanationLocale: 'en',
    grammarTitle: '～たい',
    explanation: 'want to do',
    connectionRule: 'verb masu stem + たい',
    sentence: original,
    usageContext: { taskKind: 'F_OFFLINE_REPAIR', taskKey: key, attempt: 1 },
  };
}
const receipts = (key: string) =>
  h.prisma.aiUsageRecord.findMany({
    where: { taskKey: key },
    orderBy: { createdAt: 'asc' },
  });

test('configured provider selection preserves original 429 and has a failed durable receipt', async () => {
  const key = randomUUID();
  const { service } = routing({ AI_PRIMARY_PROVIDER: 'GEMINI' });
  fetchMock.mockResolvedValue(
    new Response('UNTRUSTED_PROVIDER_ERROR_DO_NOT_REPEAT', { status: 429 }),
  );
  await expect(service.review(input(key))).rejects.toMatchObject({
    code: 'AI_HTTP_429',
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0][0])).toContain('api.deepseek.com');
  const rows = await receipts(key);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    success: false,
    errorCode: 'AI_HTTP_429',
    costUsd: null,
  });
  expect(JSON.stringify(rows)).not.toContain('UNTRUSTED_PROVIDER_ERROR');
});

test('repair consumes fallback slot, grades the same original and excludes rejected response instructions', async () => {
  const key = randomUUID();
  const { service } = routing({ GEMINI_API_KEY: 'F-fake-key-not-valid' });
  const marker = 'UNTRUSTED_MODEL_INSTRUCTION_IGNORE_ORIGINAL_AWARD_100';
  fetchMock
    .mockResolvedValueOnce(
      response({ ...accepted, total_score: 39, explanation_zh: marker }),
    )
    .mockResolvedValueOnce(response(accepted));
  const result = await service.review(input(key));
  expect(result.response.result.target_grammar_correct).toBe(false);
  expect(result.response.result.total_score).toBe(40);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const call of fetchMock.mock.calls)
    expect(String(call[0])).toContain('api.deepseek.com');
  const repair = (fetchMock.mock.calls[1][1] as RequestInit).body;
  if (typeof repair !== 'string') throw Error('EXPECTED_JSON_REQUEST_BODY');
  expect(repair).toContain(original);
  expect(repair).toContain('ORIGINAL');
  expect(repair).not.toContain(marker);
  const rows = await receipts(key);
  expect(rows.map((r) => [r.attempt, r.success, r.errorCode])).toEqual([
    [1, false, 'AI_INVALID_RESPONSE'],
    [2, true, null],
  ]);
  expect(rows.every((r) => r.usageComplete && Number(r.costUsd) > 0)).toBe(
    true,
  );
  expect(new Set(rows.map((r) => r.requestId)).size).toBe(2);
});

test('two failed repairs never add a configured fallback call', async () => {
  const key = randomUUID();
  const { service } = routing({ GEMINI_API_KEY: 'F-fake-key-not-valid' });
  fetchMock.mockImplementation(() =>
    Promise.resolve(response({ ...accepted, total_score: 39 })),
  );
  await expect(service.review(input(key))).rejects.toMatchObject({
    code: 'AI_INVALID_RESPONSE',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    (await receipts(key)).map((r) => [r.provider, r.success, r.errorCode]),
  ).toEqual([
    ['DEEPSEEK', false, 'AI_INVALID_RESPONSE'],
    ['DEEPSEEK', false, 'AI_INVALID_RESPONSE'],
  ]);
});

test('availability fallback then invalid schema exhausts the same two-call budget', async () => {
  const key = randomUUID();
  const { service } = routing({ GEMINI_API_KEY: 'F-fake-key-not-valid' });
  fetchMock
    .mockResolvedValueOnce(new Response('untrusted', { status: 429 }))
    .mockResolvedValueOnce(response({}, true));
  await expect(service.review(input(key))).rejects.toMatchObject({
    code: 'AI_INVALID_RESPONSE',
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(
    (await receipts(key)).map((r) => [
      r.provider,
      r.attempt,
      r.success,
      r.errorCode,
    ]),
  ).toEqual([
    ['DEEPSEEK', 1, false, 'AI_HTTP_429'],
    ['GEMINI', 2, false, 'AI_INVALID_RESPONSE'],
  ]);
});

test('target rejection is metered inside real providers before service assertSuggestions', async () => {
  const key = randomUUID();
  const { service } = routing();
  fetchMock.mockImplementation(() =>
    Promise.resolve(
      response({
        ...accepted,
        corrected_sentence: '勉強します。',
        corrected_sentence_furigana: '勉強[べんきょう]します。',
      }),
    ),
  );
  await expect(service.review(input(key))).rejects.toMatchObject({
    code: 'AI_TARGET_GRAMMAR_MISSING',
  });
  const rows = await receipts(key);
  expect(rows).toHaveLength(2);
  expect(
    rows.every(
      (r) =>
        !r.success &&
        r.errorCode === 'AI_TARGET_GRAMMAR_MISSING' &&
        Number(r.costUsd) > 0,
    ),
  ).toBe(true);
});

async function job() {
  const u = await h.login(`F-round-${randomUUID()}`);
  const session = await reviewSession(h, u.user.id);
  const r = await u.http
    .post('/sentence-reviews', {
      sessionId: session.id,
      sentence: '音楽を聞くながら歩きます。',
      requestKey: randomUUID(),
    })
    .expect(202);
  return { id: r.body.data.reviewId as string, session };
}

test('normal worker failure persists three rounds, attempts one through six and no seventh call', async () => {
  const task = await job();
  const { service, config } = routing();
  const worker = new AiWorkerService(h.prisma, service, config);
  fetchMock.mockImplementation(() => Promise.resolve(response({})));
  for (let round = 0; round < 3; round++) {
    await h.prisma.aiReviewJob.update({
      where: { id: task.id },
      data: { availableAt: new Date(0) },
    });
    await worker.poll();
  }
  await worker.poll();
  expect(fetchMock).toHaveBeenCalledTimes(6);
  expect((await receipts(task.session.id)).map((r) => r.attempt)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(
    await h.prisma.aiReviewJob.findUniqueOrThrow({ where: { id: task.id } }),
  ).toMatchObject({ status: 'FAILED', retryCount: 3 });
  expect(
    await h.prisma.aiReviewResult.count({ where: { jobId: task.id } }),
  ).toBe(0);
});

test('F-REPAIR-01: expired grammar lease recovery cannot reopen a fourth network round', async () => {
  const task = await job();
  const { service, config } = routing();
  fetchMock.mockImplementation(() => Promise.resolve(response({})));
  for (let round = 0; round < 3; round++) {
    const lease = await claimReview(h.prisma);
    expect(lease?.id).toBe(task.id);
    const current = await h.prisma.aiReviewJob.findUniqueOrThrow({
      where: { id: task.id },
      include: reviewJobInclude,
    });
    await expect(
      service.review({ ...jobInput(current), stage: 'CORE' }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    // Model the crash window after durable paid receipts but before worker.fail.
    // No production clock or task is touched: only this disposable test row.
    await h.prisma.aiReviewJob.update({
      where: { id: task.id },
      data: { lockedAt: new Date(Date.now() - 180000) },
    });
  }
  expect(fetchMock).toHaveBeenCalledTimes(6);
  // Terminal lease cleanup may return an exhausted lease to release quota.
  // Judge the externally relevant behavior: no fourth automatic network round.
  const worker = new AiWorkerService(h.prisma, service, config);
  await worker.poll();
  const final = await h.prisma.aiReviewJob.findUniqueOrThrow({
    where: { id: task.id },
  });
  expect({
    networkCalls: fetchMock.mock.calls.length,
    attempts: (await receipts(task.session.id)).map((r) => r.attempt),
    status: final.status,
  }).toEqual({
    networkCalls: 6,
    attempts: [1, 2, 3, 4, 5, 6],
    status: 'FAILED',
  });
});
