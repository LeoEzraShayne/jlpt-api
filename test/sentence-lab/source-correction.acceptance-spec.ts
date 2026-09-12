import { readFile } from 'node:fs/promises';
import type {
  GrammarPoint,
  GrammarExample,
  GrammarRelationGroup,
} from '@prisma/client';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import {
  applySourceCorrection,
  sourceCorrectionSchema,
} from '../../src/content-localization/source-correction';
let h: AcceptanceDatabase;
const planPath =
  'scripts/content-localization/corrections/F-language-20260913.json';
afterEach(async () => h?.stop());
test.each([false, true])(
  'guarded source correction supports pre-existing English=%s, atomic rejection and repeat no-op',
  async (existingEnglish) => {
    const original = process.env.ACCEPTANCE_ORIGINAL_STATIC_SNAPSHOT;
    if (!original) throw Error('ACCEPTANCE_ORIGINAL_STATIC_SNAPSHOT_REQUIRED');
    const snapshot = JSON.parse(await readFile(original, 'utf8')) as {
      GrammarPoint: GrammarPoint[];
      GrammarExample: GrammarExample[];
      GrammarRelationGroup: GrammarRelationGroup[];
    };
    const plan = sourceCorrectionSchema.parse(
      JSON.parse(await readFile(planPath, 'utf8')),
    );
    h = await acceptanceDatabase();
    await h.prisma.grammarPoint.createMany({ data: snapshot.GrammarPoint });
    await h.prisma.grammarExample.createMany({ data: snapshot.GrammarExample });
    await h.prisma.grammarRelationGroup.createMany({
      data: snapshot.GrammarRelationGroup,
    });
    if (existingEnglish)
      for (const edit of plan.translationEdits) {
        const old = edit.before;
        await h.prisma.contentTranslation.create({
          data: {
            ...old,
            fields: old.fields,
            provenance: old.provenance,
          },
        });
      }
    const state = async () => ({
      grammar: await h.prisma.grammarPoint.findMany({ orderBy: { id: 'asc' } }),
      examples: await h.prisma.grammarExample.findMany({
        orderBy: { id: 'asc' },
      }),
      relations: await h.prisma.grammarRelationGroup.findMany({
        orderBy: { id: 'asc' },
      }),
      translations: await h.prisma.contentTranslation.findMany({
        orderBy: { id: 'asc' },
      }),
      batches: await h.prisma.importBatch.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await state();
    const preview = await h.prisma.$transaction((tx) =>
      applySourceCorrection(tx, plan, false),
    );
    expect(preview.states.every((s) => s.state === 'PENDING')).toBe(true);
    expect(await state()).toEqual(before);
    await expect(
      h.prisma.$transaction(async (tx) => {
        await tx.grammarPoint.update({
          where: { id: 'cmsldfe5i008py1vbbm1gv6pq' },
          data: { chineseExplanation: 'F unexpected editor drift' },
        });
        await applySourceCorrection(tx, plan, true);
      }),
    ).rejects.toThrow('SOURCE_DRIFT');
    expect(await state()).toEqual(before);
    if (existingEnglish) {
      await expect(
        h.prisma.$transaction(async (tx) => {
          await tx.contentTranslation.update({
            where: { id: before.translations[0].id },
            data: { provenance: { unexpected: 'F drift' } },
          });
          await applySourceCorrection(tx, plan, true);
        }),
      ).rejects.toThrow('TRANSLATION_DRIFT');
      expect(await state()).toEqual(before);
    }
    await h.prisma.$transaction((tx) => applySourceCorrection(tx, plan, true));
    const after = await state();
    expect(after.translations).toHaveLength(existingEnglish ? 9 : 5);
    expect(after.batches).toHaveLength(before.batches.length + 1);
    const second = await h.prisma.$transaction((tx) =>
      applySourceCorrection(tx, plan, true),
    );
    expect(second.states.every((s) => s.state === 'ALREADY_APPLIED')).toBe(
      true,
    );
    expect(await state()).toEqual(after);
    const touched = new Set(plan.sourcePatches.map((p) => p.before.id));
    for (const table of ['grammar', 'examples', 'relations'] as const) {
      expect(after[table].filter((r) => !touched.has(r.id))).toEqual(
        before[table].filter((r) => !touched.has(r.id)),
      );
    }
    for (const old of before.translations.filter(
      (r) => r.entityType !== 'RELATION',
    )) {
      expect(after.translations.find((r) => r.id === old.id)).toEqual(old);
    }
    const example = after.examples.find(
      (r) => r.id === 'cmsldfe5j008qy1vbndypnc0i',
    )!;
    expect([example.sentence, example.translation]).toEqual([
      '上司に頼まれたので、引き受けないわけにはいかない。',
      '上司拜托了，所以不能不接受。',
    ]);
  },
  60000,
);
