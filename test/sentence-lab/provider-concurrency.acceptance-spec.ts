/** Mock transport verifies wiring/accounting only; these are not live quality results. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { AiReviewService } from '../../src/ai/ai-review.service';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
import { DeepSeekReviewProvider } from '../../src/ai/deepseek.provider';
import { VocabularyAiService } from '../../src/vocabulary-learning/vocabulary-ai.service';
import type { ReviewProviderInput } from '../../src/ai/ai-provider';
import type { AiVocabularyInput } from '../../src/vocabulary-learning/vocabulary-ai.schema';
import type { PrismaService } from '../../src/database/prisma.service';
let h: AcceptanceDatabase;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => jest.restoreAllMocks());

test('actual grammar and vocabulary services share a lease and independently record the paid bypass', async () => {
  const folder = 'test/sentence-lab/ai-audit/route-held-out';
  const fixtures = [] as { caseId: string; input: Record<string, unknown> }[];
  for (const file of ['cases.json', 'extra-cases.json'])
    fixtures.push(
      ...(
        JSON.parse(await readFile(`${folder}/${file}`, 'utf8')) as {
          rows: typeof fixtures;
        }
      ).rows,
    );
  const outputs = (
    JSON.parse(await readFile(`${folder}/mixed-results.json`, 'utf8')) as {
      rows: { caseId: string; result: unknown }[];
    }
  ).rows;
  const grammarInput = fixtures.find((f) => f.caseId === 'zh:natural-control')!
    .input as unknown as ReviewProviderInput;
  const vocabInput = fixtures.find((f) => f.caseId === 'zh:deliver-generate')!
    .input.vocabulary as AiVocabularyInput;
  const grammarOutput = (
    outputs.find((r) => r.caseId === 'zh:natural-control')!.result as {
      response: { result: unknown };
    }
  ).response.result;
  const vocabOutput = outputs.find(
    (r) => r.caseId === 'zh:deliver-generate',
  )!.result;
  const config = new ConfigService({
    GEMINI_FREE_FIRST: 'true',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
    GEMINI_API_KEY: `synthetic-only-${randomUUID()}`,
    GEMINI_MODEL: 'gemini-3.8-flash',
    DEEPSEEK_API_KEY: 'synthetic-only',
    DEEPSEEK_MODEL: 'deepseek-flash',
    DEEPSEEK_THINKING_EFFORT: 'low',
    DEEPSEEK_THINKING_SCOPE: 'grammar',
  });
  const db = h.prisma as PrismaService;
  const grammar = new AiReviewService(
    new GeminiReviewProvider(config, db),
    new DeepSeekReviewProvider(config, db),
    config,
    db,
  );
  const vocab = new VocabularyAiService(config, db);
  let entered!: () => void, release!: (response: Response) => void;
  const enteredPromise = new Promise<void>((r) => {
    entered = r;
  });
  const pause = new Promise<Response>((r) => {
    release = r;
  });
  const envelope = (result: unknown, gemini: boolean) =>
    new Response(
      JSON.stringify(
        gemini
          ? {
              candidates: [
                {
                  finishReason: 'STOP',
                  content: { parts: [{ text: JSON.stringify(result) }] },
                },
              ],
              usageMetadata: {
                promptTokenCount: 100,
                candidatesTokenCount: 50,
                totalTokenCount: 160,
                thoughtsTokenCount: 10,
              },
            }
          : {
              model: 'deepseek-flash',
              choices: [
                {
                  finish_reason: 'stop',
                  message: { content: JSON.stringify(result) },
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
              },
            },
      ),
    );
  const fetch = jest
    .spyOn(global, 'fetch')
    .mockImplementationOnce(async () => {
      entered();
      return pause;
    })
    .mockResolvedValueOnce(envelope(vocabOutput, false))
    .mockResolvedValueOnce(envelope(vocabOutput, true));
  const pendingGrammar = grammar.review({
    ...grammarInput,
    usageContext: { taskKey: 'F-overlap-grammar', attempt: 1 },
  });
  await enteredPromise;
  try {
    await expect(
      vocab.generate(vocabInput, { taskKey: 'F-overlap-vocab', attempt: 1 }),
    ).resolves.toEqual(vocabOutput);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toEqual(
      expect.stringContaining('api.deepseek.com'),
    );
  } finally {
    release(envelope(grammarOutput, true));
  }
  expect((await pendingGrammar).provider).toBe('GEMINI');
  await vocab.generate(vocabInput, { taskKey: 'F-after-grammar', attempt: 1 });
  expect(fetch.mock.calls[2][0]).toEqual(
    expect.stringContaining('generativelanguage.googleapis.com'),
  );
  const receipts = await h.prisma.aiUsageRecord.findMany({
    orderBy: { createdAt: 'asc' },
  });
  expect(receipts.map((r) => [r.purpose, r.provider, r.success])).toEqual([
    ['GRAMMAR_REVIEW', 'GEMINI', true],
    ['VOCABULARY_GENERATE', 'DEEPSEEK', true],
    ['VOCABULARY_GENERATE', 'GEMINI', true],
  ]);
  expect(new Set(receipts.map((r) => r.requestId)).size).toBe(3);
  expect(receipts.every((r) => r.usageComplete && Number(r.costUsd) > 0)).toBe(
    true,
  );
});
