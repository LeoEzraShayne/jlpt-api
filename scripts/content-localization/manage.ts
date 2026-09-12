import { Prisma } from '@prisma/client';
import { arg, args, database, jsonLines, readSources, writeJson } from './io';
import {
  validateArtifact,
  type TranslationArtifact,
} from '../../src/content-localization/translation-validation';
import type { ContentSource } from '../../src/content-localization/content-source';

export function coverage(
  sources: ContentSource[],
  rows: TranslationArtifact[],
) {
  const entities: Record<
    string,
    {
      total: number;
      validated: number;
      missing: number;
      stale: number;
      invalid: number;
    }
  > = {};
  const gaps: { entityType: string; entityId: string; reason: string }[] = [];
  for (const source of sources) {
    const bucket = (entities[source.entityType] ??= {
      total: 0,
      validated: 0,
      missing: 0,
      stale: 0,
      invalid: 0,
    });
    bucket.total++;
    const candidates = rows.filter(
      (r) =>
        r.entityType === source.entityType &&
        r.entityId === source.entityId &&
        r.locale === 'en',
    );
    const exact = candidates.find(
      (r) => r.sourceHash === source.sourceHash && r.status === 'VALIDATED',
    );
    let reason: 'missing' | 'stale' | 'invalid' | null = null;
    if (!exact) reason = candidates.length ? 'stale' : 'missing';
    else {
      try {
        validateArtifact(source, exact);
      } catch {
        reason = 'invalid';
      }
    }
    if (reason) {
      bucket[reason]++;
      gaps.push({
        entityType: source.entityType,
        entityId: source.entityId,
        reason,
      });
    } else bucket.validated++;
  }
  return {
    qualityVersion: 'static-en-v1',
    total: sources.length,
    validated: sources.length - gaps.length,
    complete: gaps.length === 0,
    entities,
    gaps,
  };
}
async function main() {
  const db = database();
  try {
    const sources = await readSources(db);
    const file = arg(
      '--file',
      'scripts/content-localization/translations.en.jsonl',
    );
    const rows = (await jsonLines(file)) as TranslationArtifact[];
    const report = coverage(sources, rows);
    if (args.includes('--report')) await writeJson(arg('--report'), report);
    console.log(JSON.stringify({ ...report, gaps: report.gaps.length }));
    if (!args.includes('--apply')) return;
    if (arg('--source')) throw Error('APPLY_REQUIRES_LIVE_DATABASE_SOURCES');
    const seen = new Set<string>();
    const validated = rows.map((row) => {
      const key = `${row.entityType}:${row.entityId}:${row.sourceHash}`;
      if (seen.has(key)) throw Error('DUPLICATE_ARTIFACT');
      seen.add(key);
      const original = sources.find(
        (s) => s.entityType === row.entityType && s.entityId === row.entityId,
      );
      if (!original) throw Error('SOURCE_ENTITY_MISSING');
      return validateArtifact(original, row);
    });
    if (!args.includes('--commit')) {
      console.log(JSON.stringify({ dryRun: true, valid: validated.length }));
      return;
    }
    // Atomic all-or-none import. Same file is safely repeatable; old source hashes retained.
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ',
        );
        // Lock source tables against concurrent edits while verifying and importing.
        await tx.$executeRawUnsafe(
          'LOCK TABLE "GrammarPoint", "GrammarExample", "GrammarRelationGroup", "TrainingScenario" IN SHARE MODE',
        );
        const current = await readSources(tx as unknown as typeof db);
        for (const row of validated) {
          const original = current.find(
            (s) =>
              s.entityType === row.entityType && s.entityId === row.entityId,
          );
          if (!original) throw Error('SOURCE_ENTITY_MISSING');
          validateArtifact(original, row);
          const data = {
            fields: row.fields as Prisma.InputJsonValue,
            status: row.status,
            provenance: row.provenance,
            validatedAt: row.validatedAt ? new Date(row.validatedAt) : null,
          };
          await tx.contentTranslation.upsert({
            where: {
              entityType_entityId_locale_sourceHash: {
                entityType: row.entityType,
                entityId: row.entityId,
                locale: row.locale,
                sourceHash: row.sourceHash,
              },
            },
            create: {
              entityType: row.entityType,
              entityId: row.entityId,
              locale: row.locale,
              sourceHash: row.sourceHash,
              ...data,
            },
            update: data,
          });
        }
      },
      { timeout: 120000 },
    );
    console.log(JSON.stringify({ committed: validated.length }));
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((e: unknown) => {
    console.error(
      e instanceof Error && /^[A-Z_]+$/.test(e.message)
        ? e.message
        : 'CONTENT_IMPORT_FAILED',
    );
    process.exitCode = 1;
  });
