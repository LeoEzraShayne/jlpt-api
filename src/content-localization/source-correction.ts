import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { exampleSource, grammarSource, relationSource } from './content-source';
import { translationSchema, validateArtifact } from './translation-validation';

const recordSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
export const sourceCorrectionSchema = z.object({
  version: z.literal('source-correction-v1'),
  batch: z.string().min(1),
  references: z.record(z.string(), z.url()),
  notes: z.string(),
  sourcePatches: z.array(
    z.object({
      table: z.enum(['GrammarPoint', 'GrammarExample']),
      issue: z.string(),
      before: recordSchema,
      after: recordSchema,
      beforeRecordHash: z.string(),
      afterRecordHash: z.string(),
      references: z.array(z.url()),
    }),
  ),
  translationEdits: z.array(
    z.object({
      issue: z.string(),
      before: translationSchema,
      after: translationSchema,
    }),
  ),
});
export type SourceCorrection = z.infer<typeof sourceCorrectionSchema>;
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.keys(value)
      .sort()
      .map((k) => [k, canonical((value as Record<string, unknown>)[k])]);
  return value;
}
export function recordHash(record: Record<string, unknown>) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(record)))
    .digest('hex');
}
function translationVersion(row: {
  fields: unknown;
  provenance: unknown;
  status: string;
  validatedAt: string | Date | null;
}) {
  return recordHash({
    fields: row.fields,
    provenance: row.provenance,
    status: row.status,
    validatedAt:
      row.validatedAt instanceof Date
        ? row.validatedAt.toISOString()
        : row.validatedAt,
  });
}

export function guardedState(
  current: Record<string, unknown>,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  const select = Object.fromEntries(
    Object.keys(before).map((k) => [k, current[k]]),
  );
  if (recordHash(select) === recordHash(after)) return 'ALREADY_APPLIED';
  if (recordHash(select) === recordHash(before)) return 'PENDING';
  throw Error('SOURCE_DRIFT');
}
function validatePlan(plan: SourceCorrection) {
  const seen = new Set<string>();
  for (const patch of plan.sourcePatches) {
    const key = `${patch.table}:${patch.before.id}`;
    if (seen.has(key)) throw Error('DUPLICATE_SOURCE_PATCH');
    seen.add(key);
    if (
      Object.keys(patch.before).sort().join('|') !==
        Object.keys(patch.after).sort().join('|') ||
      patch.before.id !== patch.after.id ||
      typeof patch.before.id !== 'string' ||
      recordHash(patch.before) !== patch.beforeRecordHash ||
      recordHash(patch.after) !== patch.afterRecordHash
    )
      throw Error('INVALID_SOURCE_PATCH');
    const allowed =
      patch.table === 'GrammarPoint'
        ? ['sourceHash', 'chineseExplanation', 'connectionRule']
        : ['sentence', 'translation'];
    for (const field of Object.keys(patch.before))
      if (
        patch.before[field] !== patch.after[field] &&
        !allowed.includes(field)
      )
        throw Error('FORBIDDEN_SOURCE_FIELD');
  }
  for (const edit of plan.translationEdits) {
    if (
      edit.before.entityId !== edit.after.entityId ||
      edit.before.entityType !== edit.after.entityType ||
      edit.before.locale !== edit.after.locale
    )
      throw Error('TRANSLATION_ID_CHANGE');
  }
}
/** Caller supplies a transaction; no networking or learning/identity updates. */
export async function applySourceCorrection(
  tx: Prisma.TransactionClient,
  plan: SourceCorrection,
  commit: boolean,
) {
  validatePlan(plan);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sentence-lab-source-corrections'))::text`;
  await tx.$executeRawUnsafe(
    'LOCK TABLE "GrammarPoint", "GrammarExample", "GrammarRelationGroup", "ContentTranslation" IN SHARE ROW EXCLUSIVE MODE',
  );
  const states: { entityId: string; state: string }[] = [];
  for (const patch of plan.sourcePatches) {
    const id = patch.before.id as string;
    const current =
      patch.table === 'GrammarPoint'
        ? await tx.grammarPoint.findUnique({ where: { id } })
        : await tx.grammarExample.findUnique({ where: { id } });
    if (!current) throw Error('SOURCE_ENTITY_MISSING');
    states.push({
      entityId: id,
      state: guardedState(current, patch.before, patch.after),
    });
  }
  // Validate all target translations before any source writes, including existing-version drift.
  for (const edit of plan.translationEdits) {
    const id = edit.after.entityId;
    const patch = plan.sourcePatches.find((p) => p.after.id === id);
    const target =
      patch?.after ??
      (await tx.grammarRelationGroup.findUnique({ where: { id } }));
    if (!target) throw Error('TRANSLATION_SOURCE_MISSING');
    const make =
      edit.after.entityType === 'GRAMMAR'
        ? grammarSource
        : edit.after.entityType === 'EXAMPLE'
          ? exampleSource
          : relationSource;
    validateArtifact(make(target as never), edit.after);
    const versions = await tx.contentTranslation.findMany({
      where: {
        entityType: edit.before.entityType,
        entityId: id,
        locale: edit.before.locale,
        sourceHash: { in: [edit.before.sourceHash, edit.after.sourceHash] },
      },
    });
    for (const version of versions) {
      const hash = translationVersion(version);
      const old =
        version.sourceHash === edit.before.sourceHash &&
        hash === translationVersion(edit.before);
      const updated =
        version.sourceHash === edit.after.sourceHash &&
        hash === translationVersion(edit.after);
      if (!old && !updated) throw Error('TRANSLATION_DRIFT');
    }
  }
  if (!commit) return { states, committed: false };
  for (const [index, patch] of plan.sourcePatches.entries()) {
    if (states[index].state === 'ALREADY_APPLIED') continue;
    const changes = Object.fromEntries(
      Object.keys(patch.after)
        .filter((k) => patch.after[k] !== patch.before[k])
        .map((k) => [k, patch.after[k]]),
    );
    const id = patch.before.id as string;
    if (patch.table === 'GrammarPoint')
      await tx.grammarPoint.update({
        where: { id },
        data: changes,
      });
    else
      await tx.grammarExample.update({
        where: { id },
        data: changes,
      });
  }
  for (const { after } of plan.translationEdits) {
    const where = {
      entityType_entityId_locale_sourceHash: {
        entityType: after.entityType,
        entityId: after.entityId,
        locale: after.locale,
        sourceHash: after.sourceHash,
      },
    };
    const existing = await tx.contentTranslation.findUnique({ where });
    if (
      existing &&
      recordHash(existing.fields as Record<string, unknown>) ===
        recordHash(after.fields) &&
      existing.status === after.status
    )
      continue;
    const data = {
      fields: after.fields as Prisma.InputJsonValue,
      provenance: after.provenance,
      status: after.status,
      validatedAt: new Date(after.validatedAt!),
    };
    await tx.contentTranslation.upsert({
      where,
      create: { ...where.entityType_entityId_locale_sourceHash, ...data },
      update: data,
    });
  }
  const fileHash = recordHash(plan);
  const dataset = `sentence-lab-source-correction:${plan.batch}`;
  if (!(await tx.importBatch.findFirst({ where: { dataset, fileHash } })))
    await tx.importBatch.create({
      data: {
        dataset,
        fileHash,
        fileName: `${plan.batch}.json`,
        status: 'COMMITTED',
        committedAt: new Date(),
        summary: plan,
      },
    });
  return { states, committed: true };
}

/** Only changes the five guarded source records in a copied public snapshot. */
export function correctedSnapshot(
  snapshot: Record<string, Record<string, unknown>[]>,
  plan: SourceCorrection,
) {
  validatePlan(plan);
  const result = structuredClone(snapshot);
  for (const patch of plan.sourcePatches) {
    const index = result[patch.table]?.findIndex(
      (r) => r.id === patch.before.id,
    );
    if (index === undefined || index < 0) throw Error('SOURCE_ENTITY_MISSING');
    const current = result[patch.table][index];
    guardedState(current, patch.before, patch.after);
    result[patch.table][index] = { ...current, ...patch.after };
  }
  return result;
}
