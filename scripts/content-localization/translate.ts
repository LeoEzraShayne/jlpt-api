import { appendFile } from 'node:fs/promises';
import { z } from 'zod';
import { arg, args, database, jsonLines, readSources } from './io';
import { meteredCall } from './metered-provider';
import {
  translationSchema,
  validateTranslation,
  type TranslationArtifact,
} from '../../src/content-localization/translation-validation';

async function main() {
  const db = database();
  try {
    const sources = await readSources(db),
      output = arg(
        '--output',
        'scripts/content-localization/translations.en.jsonl',
      );
    const existing = (await jsonLines(output)).map((r) =>
      translationSchema.parse(r),
    );
    const key = (r: {
      entityType: string;
      entityId: string;
      sourceHash: string;
    }) => `${r.entityType}:${r.entityId}:${r.sourceHash}`;
    const done = new Set(
      existing.filter((r) => r.status === 'VALIDATED').map(key),
    );
    const pending = sources
      .filter((s) => !done.has(key(s)))
      .slice(0, Number(arg('--limit', '100000')));
    console.log(
      JSON.stringify({
        total: sources.length,
        complete: sources.length - pending.length,
        pending: pending.length,
        run: args.includes('--run'),
      }),
    );
    if (!args.includes('--run')) return;
    const batchSize = Math.max(
      1,
      Math.min(20, Number(arg('--batch-size', '12'))),
    );
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      const instructions =
        'Translate each source.fields value from Chinese to concise natural English for JLPT learners. Preserve all original Japanese expressions and grammar notation; translate Chinese annotations. Null and empty values stay unchanged. Use plain labels for SCENARIO domain/objective/register codes. Do not change source context or add facts, teaching claims, or examples. Return {"items":[{"entityId":"...","fields":{...}}]} in the exact input order, with exactly the same field keys. Grammar terms: dictionary form, plain form, polite form, noun, i-adjective, na-adjective, conjunctive form, potential form, passive form, causative form. Sources:\n';
      const translated = await meteredCall(
        db,
        instructions + JSON.stringify(batch),
        1,
        'STATIC_TRANSLATION',
      );
      const parse = (value: unknown) =>
        z
          .object({
            items: z.array(
              z.object({
                entityId: z.string(),
                fields: z.record(z.string(), z.string().nullable()),
              }),
            ),
          })
          .parse(value).items;
      const first = parse(translated.result);
      const reviewed = await meteredCall(
        db,
        'Independently verify and correct these English translations against Chinese source meaning AND Japanese context. Check grammar connection notation, negation, nuance, register and example sentence translation. Do not invent content. Return the complete corrected items array in exactly the original order as {"items":[{"entityId":"...","fields":{...}}]}. Keep source null/empty unchanged and exact field keys. Source: ' +
          JSON.stringify(batch) +
          '\nDraft: ' +
          JSON.stringify(first),
        1,
        'STATIC_TRANSLATION_REVIEW',
      );
      const items = parse(reviewed.result);
      if (items.length !== batch.length)
        throw Error('TRANSLATION_COUNT_MISMATCH');
      const rows: TranslationArtifact[] = items.map((item, j) => {
        const original = batch[j];
        if (item.entityId !== original.entityId)
          throw Error('TRANSLATION_ID_MISMATCH');
        const issues = validateTranslation(original, item.fields);
        if (issues.length)
          throw Error(
            `QUALITY_CHECK:${original.entityType}:${original.entityId}:${issues.join(',')}`,
          );
        return {
          entityType: original.entityType,
          entityId: original.entityId,
          locale: 'en',
          sourceHash: original.sourceHash,
          fields: item.fields,
          status: 'VALIDATED',
          provenance: {
            provider: 'DEEPSEEK',
            model: translated.model,
            sourceHash: original.sourceHash,
            method:
              'model-translation-plus-independent-model-review-and-structural-checks',
            requestId: translated.requestId,
            reviewedBy: `${reviewed.model}:${reviewed.requestId}`,
            qualityVersion: 'static-en-v1',
          },
          validatedAt: new Date().toISOString(),
        };
      });
      await appendFile(
        output,
        rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
        { mode: 0o600 },
      );
      console.log(
        JSON.stringify({
          completed: Math.min(i + batchSize, pending.length),
          pending: pending.length,
        }),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error(
    'STATIC_TRANSLATION_FAILED: inspect incomplete usage records and last completed artifact batch; rerun resumes completed records.',
  );
  process.exitCode = 1;
});
