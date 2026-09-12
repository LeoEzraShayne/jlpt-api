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
