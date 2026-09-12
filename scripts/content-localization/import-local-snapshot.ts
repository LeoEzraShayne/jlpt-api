/** Disposable verification database ONLY: load public static production IDs. */
import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
import type {
  GrammarPoint,
  GrammarExample,
  GrammarRelationGroup,
  TrainingScenario,
} from '@prisma/client';
import { database, arg } from './io';
config({ path: '.env.content-verify', override: true, quiet: true });
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/jlpt_sentence_lab_content_prodverify_20260913'
  )
    throw Error('DISPOSABLE_DATABASE_REQUIRED');
  const db = database();
  try {
    const data = JSON.parse(await readFile(arg('--source'), 'utf8')) as {
      GrammarPoint: GrammarPoint[];
      GrammarExample: GrammarExample[];
      GrammarRelationGroup: GrammarRelationGroup[];
      TrainingScenario: TrainingScenario[];
    };
    await db.$transaction(async (tx) => {
      for (const g of data.GrammarPoint)
        await tx.grammarPoint.upsert({
          where: { id: g.id },
          create: {
            ...g,
            createdAt: new Date(g.createdAt),
            updatedAt: new Date(g.updatedAt),
          },
          update: {},
        });
      for (const e of data.GrammarExample)
        await tx.grammarExample.upsert({
          where: { id: e.id },
          create: e,
          update: {},
        });
      for (const r of data.GrammarRelationGroup)
        await tx.grammarRelationGroup.upsert({
          where: { id: r.id },
          create: r,
          update: {},
        });
      for (const s of data.TrainingScenario) {
        if (typeof s.levels === 'string')
          s.levels = (s.levels as string)
            .replace(/[{}]/g, '')
            .split(',') as TrainingScenario['levels'];
        await tx.trainingScenario.upsert({
          where: { id: s.id },
          create: s,
          update: s,
        });
      }
    });
    console.log(JSON.stringify({ publicStaticCorpusLoaded: true }));
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('LOCAL_CORPUS_IMPORT_FAILED');
  process.exitCode = 1;
});
