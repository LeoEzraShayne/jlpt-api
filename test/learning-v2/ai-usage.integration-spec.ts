import { AiReviewService } from '../../src/ai/ai-review.service';
import { DeepSeekReviewProvider } from '../../src/ai/deepseek.provider';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
import { ConfigService } from '@nestjs/config';
import { MeteredAiClient } from '../../src/ai/metered-ai-client';
import { startHarness, type Harness } from './harness';
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => jest.restoreAllMocks());
it('persists failed/charged attempts and distinct retries in a real database before delivering results', async () => {
  const config = new ConfigService({
    DEEPSEEK_API_KEY: 'synthetic-key',
    DEEPSEEK_MODEL: 'deepseek-flash',
  });
  const client = new MeteredAiClient(config, h.prisma);
  const taskKey = 'metered-retry';
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(async () => {
    const receipt = await h.prisma.aiUsageRecord.findFirst({
      where: { taskKey, errorCode: 'AI_IN_FLIGHT' },
    });
    expect(receipt).not.toBeNull();
    return new Response(
      JSON.stringify({
        model: 'deepseek-flash',
        usage: {
          prompt_tokens: 500,
          completion_tokens: 200,
          total_tokens: 700,
          prompt_cache_hit_tokens: 100,
          completion_tokens_details: { reasoning_tokens: 30 },
        },
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
      }),
    );
  });
  await expect(
    client.request(
      'DEEPSEEK',
      'synthetic prompt',
      'TEST',
      { taskKind: 'EVALUATION', taskKey, attempt: 1 },
      () => {
        throw Error('invalid answer');
      },
    ),
  ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
  await expect(
    client.request(
      'DEEPSEEK',
      'synthetic prompt',
      'TEST',
      { taskKind: 'EVALUATION', taskKey, attempt: 2 },
      () => true,
    ),
  ).resolves.toMatchObject({ result: true });
  expect(fetch).toHaveBeenCalledTimes(2);
  const rows = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey },
    orderBy: { attempt: 'asc' },
  });
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.requestId)).size).toBe(2);
  expect(rows.map((r) => r.success)).toEqual([false, true]);
  for (const r of rows) {
    expect(r.usageComplete).toBe(true);
    expect(r.thinkingTokens).toBe(30);
    expect(r.outputTokens).toBe(200);
    expect(Number(r.costUsd)).toBeGreaterThan(0);
    expect(JSON.stringify(r.rawUsage)).not.toContain('synthetic');
  }
});
it('timeout leaves an explicit unknown cost receipt instead of zero cost', async () => {
  const client = new MeteredAiClient(
    new ConfigService({
      DEEPSEEK_API_KEY: 'synthetic',
      DEEPSEEK_MODEL: 'deepseek-flash',
    }),
    h.prisma,
  );
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new TypeError('private network details'));
  await expect(
    client.request(
      'DEEPSEEK',
      'p',
      'TEST',
      { taskKey: 'network-failure' },
      () => true,
    ),
  ).rejects.toMatchObject({ code: 'AI_NETWORK_ERROR' });
  const r = await h.prisma.aiUsageRecord.findFirstOrThrow({
    where: { taskKey: 'network-failure' },
  });
  expect(r.errorCode).toBe('AI_NETWORK_ERROR');
  expect(r.costUsd).toBeNull();
  expect(r.inputTokens).toBeNull();
  expect(r.usageComplete).toBe(false);
});

it('repairs a strict score-sum failure within two metered calls on the original input', async () => {
  const config = new ConfigService({
    DEEPSEEK_API_KEY: 'synthetic',
    DEEPSEEK_MODEL: 'deepseek-flash',
    GEMINI_API_KEY: '',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
  });
  const original = '日本で働きたいです。';
  const valid = {
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
    corrected_sentence: original,
    corrected_sentence_furigana: '日本[にほん]で働[はたら]きたいです。',
    corrected_sentence_translation_zh: 'I want to work in Japan.',
    corrected_sentence_uses_target_grammar: true,
    explanation_zh: 'You correctly express your wish.',
    encouragement: 'Keep practicing.',
  };
  let requests = 0;
  const bodies: string[] = [];
  jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    bodies.push(init!.body as string);
    requests++;
    const output = requests === 1 ? { ...valid, total_score: 90 } : valid;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          model: 'deepseek-flash',
          usage: {
            prompt_tokens: 600,
            completion_tokens: 250,
            total_tokens: 850,
            prompt_cache_hit_tokens: 0,
          },
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(output) },
            },
          ],
        }),
      ),
    );
  });
  const service = new AiReviewService(
    new GeminiReviewProvider(config, h.prisma),
    new DeepSeekReviewProvider(config, h.prisma),
    config,
  );
  const result = await service.review({
    stage: 'CORE',
    explanationLocale: 'en',
    grammarTitle: '～たい',
    explanation: 'want to',
    sentence: original,
    usageContext: { taskKind: 'EVALUATION', taskKey: 'strict-repair' },
  });
  expect(result.response.result.total_score).toBe(100);
  expect(requests).toBe(2);
  expect(bodies[1]).toContain('EXACT sum');
  for (const body of bodies) expect(body).toContain(original);
  const rows = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey: 'strict-repair' },
    orderBy: { attempt: 'asc' },
  });
  expect(
    rows.map((r) => ({
      attempt: r.attempt,
      success: r.success,
      errorCode: r.errorCode,
    })),
  ).toEqual([
    { attempt: 1, success: false, errorCode: 'AI_INVALID_RESPONSE' },
    { attempt: 2, success: true, errorCode: null },
  ]);
  expect(rows.every((r) => r.usageComplete && Number(r.costUsd) > 0)).toBe(
    true,
  );
});
