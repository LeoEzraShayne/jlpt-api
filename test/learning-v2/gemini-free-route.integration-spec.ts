import { ConfigService } from '@nestjs/config';
import { routeAi } from '../../src/ai/ai-routing';
import {
  PrismaGeminiCircuit,
  geminiCircuitKey,
} from '../../src/ai/gemini-free-circuit';
import {
  geminiHttpFailure,
  nextPacificMidnight,
} from '../../src/ai/gemini-failure';
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
const providers = [{ name: 'DEEPSEEK' as const }, { name: 'GEMINI' as const }];
const config = () =>
  new ConfigService({
    GEMINI_FREE_FIRST: true,
    GEMINI_API_KEY: 'synthetic-gemini',
    GEMINI_MODEL: 'gemini-3.8-flash',
    DEEPSEEK_API_KEY: 'synthetic-ds',
    DEEPSEEK_MODEL: 'deepseek-flash',
  });
it('admits one free candidate under racing process leases and persists daily cooldown across instances', async () => {
  const key = geminiCircuitKey('concurrent-key', 'gemini-3.8-flash');
  const first = new PrismaGeminiCircuit(h.prisma),
    second = new PrismaGeminiCircuit(h.prisma);
  const leases = await Promise.all(
    Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).acquire(key)),
  );
  expect(leases.filter(Boolean)).toHaveLength(1);
  const lease = leases.find(Boolean)!;
  await first.release(
    lease,
    geminiHttpFailure(429, {
      error: {
        details: [
          {
            violations: [
              { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
            ],
          },
        ],
      },
    }),
  );
  const stored = await h.prisma.aiProviderCircuit.findUniqueOrThrow({
    where: { key },
  });
  expect(stored.blockedUntil?.toISOString()).toBe(
    nextPacificMidnight(new Date()).toISOString(),
  );
  expect(await new PrismaGeminiCircuit(h.prisma).acquire(key)).toBeNull();
  expect(stored.key).not.toContain('concurrent-key');
});
it('does not let a stale lease holder erase a newer owner or cooldown', async () => {
  const key = geminiCircuitKey('lease-key', 'gemini-3.8-flash');
  const gate = new PrismaGeminiCircuit(h.prisma);
  const old = (await gate.acquire(key))!;
  await h.prisma.aiProviderCircuit.update({
    where: { key },
    data: { leaseUntil: new Date(0) },
  });
  const fresh = (await gate.acquire(key))!;
  await gate.release(old, geminiHttpFailure(404, {}));
  expect(
    (await h.prisma.aiProviderCircuit.findUniqueOrThrow({ where: { key } }))
      .leaseToken,
  ).toBe(fresh.token);
  await gate.release(fresh);
  expect(await gate.acquire(key)).not.toBeNull();
});
it('records free quota rejection then DS success, skips cooled Gemini without a fake receipt', async () => {
  const c = config();
  const meter = new MeteredAiClient(c, h.prisma);
  const key = geminiCircuitKey('synthetic-gemini', 'gemini-3.8-flash');
  await h.prisma.aiProviderCircuit.deleteMany({ where: { key } });
  const fetch = jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const receiptCheck = h.prisma.aiUsageRecord.count({
      where: { errorCode: 'AI_IN_FLIGHT' },
    });
    return receiptCheck.then((count) => {
      expect(count).toBeGreaterThan(0);
      if ((typeof url === 'string' ? url : '').includes('googleapis'))
        return new Response(
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
        );
      return new Response(
        JSON.stringify({
          model: 'deepseek-flash',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 0,
          },
          choices: [
            { finish_reason: 'stop', message: { content: '{"ok":true}' } },
          ],
        }),
      );
    });
  });
  const call = async (taskKey: string) =>
    routeAi(
      providers,
      async (p, index) => {
        const r = await meter.request(
          p.name,
          'synthetic',
          'GRAMMAR_REVIEW',
          { taskKey, attempt: index + 1 },
          () => true,
        );
        return r.result;
      },
      c,
      h.prisma,
    );
  await expect(call('quota-round')).resolves.toMatchObject({
    provider: { name: 'DEEPSEEK' },
    response: true,
  });
  const receipts = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey: 'quota-round' },
    orderBy: { attempt: 'asc' },
  });
  expect(receipts.map((r) => [r.provider, r.success])).toEqual([
    ['GEMINI', false],
    ['DEEPSEEK', true],
  ]);
  expect(receipts[0].costUsd).toBeNull();
  expect(Number(receipts[1].costUsd)).toBeGreaterThan(0);
  await call('cooled-round');
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(
    (
      await h.prisma.aiUsageRecord.findMany({
        where: { taskKey: 'cooled-round' },
      })
    ).map((r) => r.provider),
  ).toEqual(['DEEPSEEK']);
});
it('records charged Gemini quality rejection before second-slot DS, without changing DS repair policy', async () => {
  const c = config();
  const key = geminiCircuitKey('synthetic-gemini', 'gemini-3.8-flash');
  await h.prisma.aiProviderCircuit.deleteMany({ where: { key } });
  const meter = new MeteredAiClient(c, h.prisma);
  jest.spyOn(global, 'fetch').mockImplementation((url) =>
    Promise.resolve(
      new Response(
        JSON.stringify(
          (typeof url === 'string' ? url : '').includes('googleapis')
            ? {
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 20,
                  thoughtsTokenCount: 10,
                  totalTokenCount: 130,
                },
                candidates: [
                  {
                    finishReason: 'STOP',
                    content: { parts: [{ text: 'invalid' }] },
                  },
                ],
              }
            : {
                model: 'deepseek-flash',
                usage: {
                  prompt_tokens: 100,
                  completion_tokens: 20,
                  total_tokens: 120,
                },
                choices: [
                  { finish_reason: 'stop', message: { content: 'valid' } },
                ],
              },
        ),
      ),
    ),
  );
  await routeAi(
    providers,
    async (p, i) =>
      (
        await meter.request(
          p.name,
          'synthetic',
          'VOCABULARY_ASSESS',
          { taskKey: 'quality-round', attempt: i + 1 },
          (s) => {
            if (s === 'invalid') throw Error('strict failure');
            return s;
          },
        )
      ).result,
    c,
    h.prisma,
  );
  const rows = await h.prisma.aiUsageRecord.findMany({
    where: { taskKey: 'quality-round' },
    orderBy: { attempt: 'asc' },
  });
  expect(rows.map((r) => r.success)).toEqual([false, true]);
  expect(rows.every((r) => r.usageComplete && Number(r.costUsd) > 0)).toBe(
    true,
  );
  expect(rows[0].thinkingTokens).toBe(10);
});
