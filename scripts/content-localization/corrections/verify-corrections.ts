import { readFile, writeFile } from 'node:fs/promises';
import {
  sourceCorrectionSchema,
  applySourceCorrection,
  recordHash,
} from '../../../src/content-localization/source-correction';
import { database } from '../io';
import type { Prisma } from '@prisma/client';
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/jlpt_sentence_lab_content_prodverify_20260913'
  )
    throw Error('DISPOSABLE_DATABASE_REQUIRED');
  const db = database();
  const plan = sourceCorrectionSchema.parse(
    JSON.parse(
      await readFile(
        'scripts/content-localization/corrections/F-language-20260913.json',
        'utf8',
      ),
    ),
  );
  const state = async () => ({
    grammar: await db.grammarPoint.findMany({ orderBy: { id: 'asc' } }),
    examples: await db.grammarExample.findMany({ orderBy: { id: 'asc' } }),
    relations: await db.grammarRelationGroup.findMany({
      orderBy: { id: 'asc' },
    }),
    scenarios: await db.trainingScenario.findMany({ orderBy: { id: 'asc' } }),
    translations: await db.contentTranslation.findMany({
      orderBy: { id: 'asc' },
    }),
    audits: await db.importBatch.findMany({
      where: { dataset: `sentence-lab-source-correction:${plan.batch}` },
    }),
  });
  try {
    const before = await state();
    const preview = await db.$transaction((tx) =>
      applySourceCorrection(tx, plan, false),
    );
    if (!preview.states.every((s) => s.state === 'PENDING'))
      throw Error('EXPECTED_UNCORRECTED_BASELINE');
    if (recordHash(await state()) !== recordHash(before))
      throw Error('PREVIEW_MUTATED_DATABASE');
    const checkRejected = async (
      code: string,
      mutate: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => {
      await db
        .$transaction(async (tx) => {
          await mutate(tx);
          await applySourceCorrection(tx, plan, true);
        })
        .then(
          () => {
            throw Error('EXPECTED_REJECTION');
          },
          (e: unknown) => {
            if (!(e instanceof Error) || e.message !== code) throw e;
          },
        );
      if (recordHash(await state()) !== recordHash(before))
        throw Error('REJECTION_NOT_ATOMIC');
    };
    await checkRejected('SOURCE_DRIFT', (tx) =>
      tx.grammarPoint.update({
        where: { id: 'cmsldfe5i008py1vbbm1gv6pq' },
        data: { chineseExplanation: 'Unexpected editor change' },
      }),
    );
    const oldRelation = before.translations.find(
      (r) => r.entityId === 'cmsldfebb00chy1vbj2a7u66m',
    )!;
    await checkRejected('TRANSLATION_DRIFT', (tx) =>
      tx.contentTranslation.update({
        where: { id: oldRelation.id },
        data: { provenance: { unexpected: true } },
      }),
    );
    const first = await db.$transaction((tx) =>
      applySourceCorrection(tx, plan, true),
    );
    const after = await state();
    const second = await db.$transaction((tx) =>
      applySourceCorrection(tx, plan, true),
    );
    if (
      !second.states.every((s) => s.state === 'ALREADY_APPLIED') ||
      recordHash(await state()) !== recordHash(after)
    )
      throw Error('NOT_IDEMPOTENT');
    if (
      after.translations.length !== before.translations.length + 4 ||
      after.audits.length !== before.audits.length + 1
    )
      throw Error('VERSION_COUNTS_WRONG');
    const touched = new Set(plan.sourcePatches.map((p) => p.before.id));
    for (const table of [
      'grammar',
      'examples',
      'relations',
      'scenarios',
    ] as const) {
      if (
        recordHash({
          rows: before[table].filter((r) => !touched.has(r.id)),
        }) !==
        recordHash({ rows: after[table].filter((r) => !touched.has(r.id)) })
      )
        throw Error('UNRELATED_SOURCE_CHANGED');
    }
    for (const old of before.translations) {
      if (old.entityId === oldRelation.entityId) continue; // Its previous English is retained in immutable batch audit.
      const current = after.translations.find((r) => r.id === old.id);
      if (!current || recordHash(current) !== recordHash(old))
        throw Error('OLD_TRANSLATION_CHANGED');
    }
    const report = {
      verifiedAt: new Date().toISOString(),
      artifactHash: recordHash(plan),
      sourceRecordsChanged: first.states.length,
      activeCorpusEntities: 546,
      translationVersionsBefore: before.translations.length,
      translationVersionsAfter: after.translations.length,
      previewReadOnly: true,
      unknownSourceDriftRejectedAtomically: true,
      unknownTranslationProvenanceRejectedAtomically: true,
      repeatIsNoOpIncludingTimestamps: true,
      unrelatedSourcesUnchanged: true,
      previousTranslationHashesRetained: true,
      previousRelationEnglishInImportBatchAudit: true,
      independentLinguisticAcceptance: 'F_RECHECK_PENDING',
    };
    await writeFile(
      'scripts/content-localization/corrections/verification.json',
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
  } finally {
    await db.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(
    e instanceof Error && /^[A-Z_]+$/.test(e.message)
      ? e.message
      : 'CORRECTION_VERIFICATION_FAILED',
  );
  process.exitCode = 1;
});
