/** Integration verification on an explicitly isolated local corpus database only. */
import { readFile } from 'node:fs/promises';
import { PrismaService } from '../../src/database/prisma.service';
import {
  type LocalizedContent,
  ContentLocalizationService,
} from '../../src/content-localization/content-localization.service';
import { database, arg } from './io';
import type { TrainingScenario } from '@prisma/client';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(url.hostname) ||
    !url.pathname.includes('sentence_lab_content')
  )
    throw Error('ISOLATED_LOCAL_DB_REQUIRED');
  const db = database();
  try {
    if (arg('--sync-scenarios')) {
      const snapshot = JSON.parse(
        await readFile(arg('--sync-scenarios'), 'utf8'),
      ) as { TrainingScenario: TrainingScenario[] };
      for (const scenario of snapshot.TrainingScenario) {
        if (typeof scenario.levels === 'string')
          scenario.levels = (scenario.levels as string)
            .replace(/[{}]/g, '')
            .split(',') as TrainingScenario['levels'];
        await db.trainingScenario.upsert({
          where: { id: scenario.id },
          create: scenario,
          update: scenario,
        });
      }
      console.log(
        JSON.stringify({
          localScenariosSynced: snapshot.TrainingScenario.length,
        }),
      );
      return;
    }
    const grammar = await db.grammarPoint.findMany({
      where: { status: 'PUBLISHED' },
      include: {
        examples: true,
        relationMembers: { include: { group: true } },
      },
    });
    const localization = new ContentLocalizationService(db as PrismaService);
    const result = await localization.grammar(grammar, 'en');
    const missing = result.filter(
      (r) =>
        r.localized.status !== 'VALIDATED' ||
        r.examples.some(
          (e) =>
            (e as typeof e & { localized?: LocalizedContent }).localized
              ?.status !== 'VALIDATED',
        ),
    );
    if (missing.length) throw Error('ENGLISH_READING_INCOMPLETE');
    const row = grammar[0],
      before = await db.contentTranslation.count();
    // Transaction rollback verifies stale detection without changing the corpus.
    await db
      .$transaction(async (tx) => {
        const updated = await tx.grammarPoint.update({
          where: { id: row.id },
          data: { chineseExplanation: row.chineseExplanation + '测试' },
        });
        const view = await new ContentLocalizationService(
          tx as PrismaService,
        ).grammar([updated], 'en');
        if (
          view[0].localized.status !== 'STALE' ||
          view[0].localized.fields !== null
        )
          throw Error('STALE_NOT_REJECTED');
        throw Error('EXPECTED_ROLLBACK');
      })
      .catch((e: unknown) => {
        if (!(e instanceof Error) || e.message !== 'EXPECTED_ROLLBACK') throw e;
      });
    if ((await db.contentTranslation.count()) !== before)
      throw Error('UNEXPECTED_WRITE');
    console.log(
      JSON.stringify({
        grammarReads: result.length,
        missing: 0,
        staleRollbackVerified: true,
        translationRows: before,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(
    'LOCAL_VERIFICATION_FAILED',
    e instanceof Error && /^[A-Z_]+$/.test(e.message)
      ? e.message
      : ((e as { code?: string }).code ?? 'UNKNOWN'),
  );
  process.exitCode = 1;
});
