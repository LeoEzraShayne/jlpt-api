/** Authorized synthetic run only. Frozen inputs; actual service route; 24 ops / 48 requests ceiling. */
import { readFile, writeFile, access } from 'node:fs/promises';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase } from '../../database';
import { AiReviewService } from '../../../../src/ai/ai-review.service';
import { DeepSeekReviewProvider } from '../../../../src/ai/deepseek.provider';
import { GeminiReviewProvider } from '../../../../src/ai/gemini.provider';
import { VocabularyAiService } from '../../../../src/vocabulary-learning/vocabulary-ai.service';
import {
  ProviderError,
  type ReviewProviderInput,
} from '../../../../src/ai/ai-provider';
import type { PrismaService } from '../../../../src/database/prisma.service';
import type {
  AiVocabularyInput,
  Challenge,
} from '../../../../src/vocabulary-learning/vocabulary-ai.schema';
type Case = {
  caseId: string;
  kind: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
};
async function main() {
  if (!process.argv.includes('--run')) throw Error('EXPLICIT_RUN_REQUIRED');
  const folder = 'test/sentence-lab/ai-audit/route-held-out';
  for (const name of [
    'mixed-results.json',
    'mixed-raw.json',
    'mixed-usage.json',
  ])
    if (
      await access(`${folder}/${name}`).then(
        () => true,
        () => false,
      )
    )
      throw Error('IMMUTABLE_RESULTS_EXIST');
  const cases: Case[] = [];
  for (const name of ['cases.json', 'extra-cases.json'])
    cases.push(
      ...(
        JSON.parse(await readFile(`${folder}/${name}`, 'utf8')) as {
          rows: Case[];
        }
      ).rows,
    );
  if (cases.length !== 24) throw Error('EXACTLY_24_FROZEN_OPERATIONS_REQUIRED');
  const credential = process.env.F_CREDENTIAL_FILE;
  if (!credential) throw Error('CREDENTIAL_FILE_REQUIRED');
  const key = parse(await readFile(credential, 'utf8')).DEEPSEEK_API_KEY;
  if (!key) throw Error('KEY_MISSING');
  const config = new ConfigService({
    DEEPSEEK_API_KEY: key,
    GEMINI_API_KEY: '',
    DEEPSEEK_MODEL: 'deepseek-flash',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
    DEEPSEEK_THINKING_EFFORT: 'low',
    DEEPSEEK_THINKING_SCOPE: 'grammar',
  });
  const h = await acceptanceDatabase(),
    db = h.prisma as PrismaService;
  const grammar = new AiReviewService(
      new GeminiReviewProvider(config, db),
      new DeepSeekReviewProvider(config, db),
      config,
    ),
    vocab = new VocabularyAiService(config, db);
  const runId = new Date().toISOString(),
    rows: unknown[] = [],
    raw: unknown[] = [];
  let totalCalls = 0,
    currentCalls = 0,
    current: Case;
  const originalFetch = global.fetch;
  global.fetch = async (...args) => {
    if (totalCalls >= 48 || currentCalls >= 2)
      throw new ProviderError(
        'F hard network ceiling reached',
        'F_NETWORK_LIMIT',
        false,
      );
    totalCalls++;
    currentCalls++;
    const body = (args[1] as RequestInit).body;
    if (typeof body !== 'string') throw Error('EXPECTED_JSON_REQUEST_BODY');
    const payload = JSON.parse(body) as {
      thinking?: unknown;
      reasoning_effort?: unknown;
      max_tokens?: unknown;
      messages: { content: string }[];
    };
    const prompt = payload.messages.map((m) => m.content).join('\n');
    const meta = {
      caseId: current.caseId,
      ordinal: currentCalls,
      thinking: payload.thinking,
      reasoningEffort: payload.reasoning_effort,
      maxTokens: payload.max_tokens,
      originalSentenceRetained:
        typeof current.input.sentence === 'string'
          ? prompt.includes(current.input.sentence)
          : null,
      repair: prompt.includes('VALIDATION_FEEDBACK:'),
    };
    const response = await originalFetch(...args);
    if (response.ok) {
      const envelope = (await response.clone().json()) as {
        model?: string;
        choices?: { finish_reason?: string; message?: { content?: string } }[];
        usage?: unknown;
      };
      raw.push({
        ...meta,
        model: envelope.model,
        finishReason: envelope.choices?.[0]?.finish_reason,
        content: envelope.choices?.[0]?.message?.content,
        usage: envelope.usage,
      });
    } else raw.push({ ...meta, httpStatus: response.status });
    await writeFile(
      `${folder}/mixed-raw.json`,
      JSON.stringify({ runId, raw }, null, 2),
      { mode: 0o600 },
    );
    return response;
  };
  try {
    for (const c of cases) {
      current = c;
      currentCalls = 0;
      const start = Date.now();
      const usageContext = {
        taskKind: 'F_MIXED_HELD_OUT',
        taskKey: `${runId}:${c.caseId}`,
        attempt: 1,
      };
      try {
        const result =
          c.kind === 'grammar'
            ? await grammar.review({
                ...(c.input as unknown as ReviewProviderInput),
                usageContext,
              })
            : c.kind === 'generate'
              ? await vocab.generate(
                  c.input.vocabulary as AiVocabularyInput,
                  usageContext,
                )
              : await vocab.assess(
                  c.input.vocabulary as AiVocabularyInput,
                  c.input.challenge as Challenge,
                  c.input.sentence as string,
                  usageContext,
                );
        rows.push({
          caseId: c.caseId,
          kind: c.kind,
          result,
          requests: currentCalls,
          latencyMs: Date.now() - start,
        });
      } catch (e) {
        rows.push({
          caseId: c.caseId,
          kind: c.kind,
          error: e instanceof ProviderError ? e.code : 'F_EVALUATION_FAILED',
          requests: currentCalls,
          latencyMs: Date.now() - start,
        });
      }
      await writeFile(
        `${folder}/mixed-results.json`,
        JSON.stringify({ runId, rows }, null, 2),
        { mode: 0o600 },
      );
      console.log(c.caseId, `recorded (${currentCalls} requests)`);
    }
  } finally {
    global.fetch = originalFetch;
    const usage = await db.aiUsageRecord.findMany({
      where: { taskKind: 'F_MIXED_HELD_OUT', taskKey: { startsWith: runId } },
      orderBy: { createdAt: 'asc' },
    });
    await writeFile(
      `${folder}/mixed-usage.json`,
      JSON.stringify(usage, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        operations: rows.length,
        networkRequests: totalCalls,
        receipts: usage.length,
        knownCostUsd: usage.reduce((s, r) => s + Number(r.costUsd ?? 0), 0),
        unknownUsageCalls: usage.filter((r) => r.costUsd === null).length,
      }),
    );
    await h.stop();
  }
}
main().catch(() => {
  console.error('F_MIXED_RUN_FAILED');
  process.exitCode = 1;
});
