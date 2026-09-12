/** Main-agent-only isolated server diagnostic; no production database. */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { fileReceipts } from './file-receipts';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
const path = process.argv
  .find((a) => a.startsWith('--receipt-file='))
  ?.slice(15);
if (!path) throw Error('fsynced receipt file required');
const db = fileReceipts(path);
const original = global.fetch;
const diagnostic: unknown[] = [];
global.fetch = async (...args) => {
  const response = await original(...args);
  const body = await response.clone().text();
  const envelope = JSON.parse(body) as Record<string, unknown>;
  if (!response.ok) {
    const error = envelope.error as
      | {
          code?: number;
          status?: string;
          details?: Array<{
            reason?: string;
            domain?: string;
            violations?: Array<{
              quotaMetric?: string;
              quotaId?: string;
              quotaValue?: string;
            }>;
          }>;
        }
      | undefined;
    const safe = {
      httpStatus: response.status,
      status: error?.status,
      details: error?.details?.map((d) => ({
        reason: d.reason,
        domain: d.domain,
        violations: d.violations?.map((v) => ({
          quotaMetric: v.quotaMetric,
          quotaId: v.quotaId,
          quotaValue: v.quotaValue,
        })),
      })),
    };
    diagnostic.push(safe);
    console.log(JSON.stringify(safe));
  } else if (String(args[0]).includes(':generateContent'))
    diagnostic.push({ syntheticResponse: envelope });
  return response;
};
async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Error('Gemini key required');
  const r = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    { headers: { 'x-goog-api-key': key } },
  );
  const data = (await r.json()) as {
    models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
  };
  console.log(
    JSON.stringify({
      availableModels: data.models
        ?.filter((m) =>
          m.supportedGenerationMethods?.includes('generateContent'),
        )
        .map((m) => m.name),
    }),
  );
  const model = process.argv
    .find((a) => a.startsWith('--probe-model='))
    ?.slice(14);
  if (model) {
    const config = new ConfigService({ ...process.env, GEMINI_MODEL: model });
    try {
      const result = await new GeminiReviewProvider(config, db).review({
        stage: 'CORE',
        explanationLocale: 'en',
        grammarTitle: '～ながら',
        explanation: '同一主体同时进行两个动作',
        connectionRule: '动词ます形去ます＋ながら',
        sentence: '音楽を聞くながら料理をします。',
        usageContext: {
          taskKind: 'EVALUATION_DIAGNOSTIC',
          taskKey: `${model}-connection`,
        },
      });
      diagnostic.push({ parsedResult: result });
      console.log('Synthetic probe completed');
    } catch {
      console.log('Synthetic probe failed; durable receipt retained');
    }
  }
  writeFileSync('diagnostic.json', JSON.stringify(diagnostic, null, 2), {
    mode: 0o600,
  });
  await db.$disconnect();
}
main().catch(() => {
  console.error('Diagnostic failed; no secret output');
  process.exitCode = 1;
});
