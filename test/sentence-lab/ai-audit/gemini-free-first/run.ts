/** Main agent only: explicit --run, synthetic local DB, 12 operations / 24 network ceiling. */
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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

type Case = { caseId: string; kind: string; input: Record<string, unknown> };
async function main() {
  if (!process.argv.includes('--run')) throw Error('EXPLICIT_RUN_REQUIRED');
  const base = 'test/sentence-lab/ai-audit/gemini-free-first';
  const source = await readFile(`${base}/cases.json`);
  const manifest = JSON.parse(
    await readFile(`${base}/manifest.json`, 'utf8'),
  ) as { fixtureSha256: string };
  if (
    createHash('sha256').update(source).digest('hex') !== manifest.fixtureSha256
  )
    throw Error('FIXTURE_HASH_MISMATCH');
  const frozen = (JSON.parse(source.toString()) as { rows: Case[] }).rows;
  if (frozen.length !== 12)
    throw Error('EXACTLY_12_FROZEN_OPERATIONS_REQUIRED');
  const selected = process.env.F_CASE_IDS?.split(',');
  if (
    selected &&
    (new Set(selected).size !== selected.length ||
      selected.some((id) => !frozen.some((c) => c.caseId === id)))
  )
    throw Error('INVALID_EXPLICIT_SUBSET');
  const cases = selected
    ? selected.map((id) => frozen.find((c) => c.caseId === id)!)
    : frozen;
  const spacing = Number(process.env.F_CALL_SPACING_MS ?? 0);
  if (!Number.isSafeInteger(spacing) || spacing < 0 || spacing > 65_000)
    throw Error('INVALID_SPACING');
  if (!process.env.F_OUTPUT_DIR || !process.env.F_CANDIDATE_COMMIT)
    throw Error('OUTPUT_AND_CANDIDATE_REQUIRED');
  const output = resolve(process.env.F_OUTPUT_DIR);
  await mkdir(output, { mode: 0o700 }); // Existing output is intentionally refused.
  const settings: Record<string, string> = {};
  for (const name of [
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL',
    'DEEPSEEK_THINKING_EFFORT',
    'DEEPSEEK_THINKING_SCOPE',
    'GEMINI_FREE_FIRST',
  ]) {
    if (!process.env[name]) throw Error(`REQUIRED_CONFIGURATION_${name}`);
    settings[name] = process.env[name]!;
  }
  if (
    settings.GEMINI_FREE_FIRST !== 'true' ||
    settings.DEEPSEEK_MODEL !== 'deepseek-flash' ||
    settings.DEEPSEEK_THINKING_EFFORT !== 'low' ||
    settings.DEEPSEEK_THINKING_SCOPE !== 'grammar'
  )
    throw Error('EXPECTED_ROUTE_CONFIGURATION_REQUIRED');
  const config = new ConfigService(settings);
  const h = await acceptanceDatabase(),
    db = h.prisma as PrismaService;
  const grammar = new AiReviewService(
    new GeminiReviewProvider(config, db),
    new DeepSeekReviewProvider(config, db),
    config,
    db,
  );
  const vocab = new VocabularyAiService(config, db);
  const runId = new Date().toISOString();
  const raw: unknown[] = [],
    rows: unknown[] = [];
  let totalCalls = 0,
    geminiCalls = 0,
    currentCalls = 0,
    current: Case;
  const originalFetch = global.fetch;
  const save = (name: string, value: unknown) =>
    writeFile(`${output}/${name}.json`, JSON.stringify(value, null, 2), {
      mode: 0o600,
    });
  global.fetch = async (...args) => {
    const endpoint = args[0];
    const url = new URL(endpoint instanceof Request ? endpoint.url : endpoint);
    const gemini = url.hostname === 'generativelanguage.googleapis.com';
    if (!gemini && url.hostname !== 'api.deepseek.com')
      throw Error('PROVIDER_ENDPOINT_NOT_ALLOWLISTED');
    if (totalCalls >= 24 || currentCalls >= 2 || (gemini && geminiCalls >= 12))
      throw new ProviderError(
        'F bounded run ceiling',
        'F_NETWORK_LIMIT',
        false,
      );
    totalCalls++;
    currentCalls++;
    if (gemini) geminiCalls++;
    const body = args[1]?.body;
    if (typeof body !== 'string') throw Error('JSON_REQUEST_BODY_REQUIRED');
    const payload = JSON.parse(body) as {
      contents?: { parts: { text: string }[] }[];
      messages?: { content: string }[];
      thinking?: unknown;
      reasoning_effort?: unknown;
      max_tokens?: unknown;
      generationConfig?: unknown;
    };
    const prompt = gemini
      ? payload.contents!.flatMap((c) => c.parts.map((p) => p.text)).join('\n')
      : payload.messages!.map((m) => m.content).join('\n');
    const meta = {
      caseId: current.caseId,
      ordinal: currentCalls,
      provider: gemini ? 'GEMINI' : 'DEEPSEEK',
      originalSentenceRetained:
        typeof current.input.sentence === 'string'
          ? prompt.includes(current.input.sentence)
          : null,
      repair: prompt.includes('VALIDATION_FEEDBACK:'),
      thinking: payload.thinking,
      reasoningEffort: payload.reasoning_effort,
      maxTokens: payload.max_tokens,
      generationConfig: payload.generationConfig,
    };
    try {
      const response = await originalFetch(...args);
      if (response.ok) {
        const envelope = (await response.clone().json()) as {
          model?: string;
          usage?: unknown;
          usageMetadata?: unknown;
          candidates?: {
            finishReason?: string;
            content?: { parts?: { thought?: boolean; text?: string }[] };
          }[];
          choices?: {
            finish_reason?: string;
            message?: { content?: string };
          }[];
        };
        raw.push({
          ...meta,
          httpStatus: response.status,
          model: envelope.model,
          finishReason: gemini
            ? envelope.candidates?.[0]?.finishReason
            : envelope.choices?.[0]?.finish_reason,
          content: gemini
            ? envelope.candidates?.[0]?.content?.parts
                ?.filter((p) => !p.thought)
                .map((p) => p.text ?? '')
                .join('')
            : envelope.choices?.[0]?.message?.content,
          usage: gemini ? envelope.usageMetadata : envelope.usage,
        });
      } else raw.push({ ...meta, httpStatus: response.status });
      return response;
    } catch (error) {
      raw.push({ ...meta, transportFailure: true });
      throw error;
    } finally {
      await save('raw', { runId, raw });
    }
  };
  try {
    for (const c of cases) {
      if (rows.length && spacing) {
        const circuit = await db.aiProviderCircuit.findFirst({
          select: { blockedUntil: true },
        });
        const waitUntil = Math.max(
          Date.now() + spacing,
          circuit?.blockedUntil?.getTime() ?? 0,
        );
        if (waitUntil - Date.now() > 360_000)
          throw Error('COOLDOWN_EXCEEDS_BOUNDED_RUN');
        while (Date.now() < waitUntil) {
          console.log(
            'F waiting for scheduled spacing / isolated provider cooldown',
          );
          await new Promise((resolve) =>
            setTimeout(resolve, Math.min(30_000, waitUntil - Date.now())),
          );
        }
      }
      current = c;
      currentCalls = 0;
      const start = Date.now();
      const usageContext = {
        taskKind: 'F_GEMINI_FREE_FIRST',
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
      } catch (error) {
        rows.push({
          caseId: c.caseId,
          kind: c.kind,
          error:
            error instanceof ProviderError ? error.code : 'F_EVALUATION_FAILED',
          requests: currentCalls,
          latencyMs: Date.now() - start,
        });
      }
      await save('results', {
        runId,
        candidateCommit: process.env.F_CANDIDATE_COMMIT,
        fixtureSha256: manifest.fixtureSha256,
        geminiModel: settings.GEMINI_MODEL,
        selectedCaseIds: cases.map((c) => c.caseId),
        callSpacingMs: spacing,
        rows,
      });
      console.log(c.caseId, `recorded (${currentCalls} requests)`);
    }
  } finally {
    global.fetch = originalFetch;
    const usage = await db.aiUsageRecord.findMany({
      where: {
        taskKind: 'F_GEMINI_FREE_FIRST',
        taskKey: { startsWith: runId },
      },
      orderBy: { createdAt: 'asc' },
    });
    await save('usage', usage);
    console.log(
      JSON.stringify({
        operations: rows.length,
        networkRequests: totalCalls,
        geminiRequests: geminiCalls,
        receipts: usage.length,
        unknownUsageCalls: usage.filter((r) => !r.usageComplete).length,
      }),
    );
    await h.stop();
  }
}
main().catch(() => {
  console.error('F_GEMINI_RUN_FAILED');
  process.exitCode = 1;
});
