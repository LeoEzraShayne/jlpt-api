/** Export only synthetic evaluation receipts from the guarded local DB. */
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.pathname !== '/jlpt_sentence_lab_ai_20260913'
)
  throw Error('Local evaluation database only');
async function main() {
  const db = new PrismaService(new ConfigService(process.env));
  const local = await db.aiUsageRecord.findMany({
    where: { taskKind: { in: ['EVALUATION', 'EVALUATION_DIAGNOSTIC'] } },
    orderBy: { createdAt: 'asc' },
  });
  const serverFiles = [
    'usage-gemini-server-initial.json',
    'usage-gemini31-v2.json',
  ];
  const remote = serverFiles.flatMap(
    (f) =>
      JSON.parse(readFileSync(`scripts/ai-cost/${f}`, 'utf8')) as Array<
        Record<string, unknown>
      >,
  );
  const rows = [...local, ...remote];
  const unique = [...new Map(rows.map((r) => [r.requestId, r])).values()];
  const totalKnown = unique.reduce((s, r) => s + Number(r.costUsd ?? 0), 0);
  writeFileSync(
    'scripts/ai-cost/usage-all-evaluation.json',
    JSON.stringify(
      {
        scope:
          'Synthetic local and main-operated server regression; separate server diagnostic probe receipt is outside this sum',
        calls: unique.length,
        unknownCostCalls: unique.filter((r) => r.costUsd === null).length,
        knownPaidCostUsd: totalKnown,
        rows: unique,
      },
      null,
      2,
    ),
  );
  console.log({
    calls: unique.length,
    unknownCostCalls: unique.filter((r) => r.costUsd === null).length,
    knownPaidCostUsd: totalKnown,
  });
  await db.$disconnect();
}
main().catch(() => {
  console.error('Audit export failed without secret output');
  process.exitCode = 1;
});
