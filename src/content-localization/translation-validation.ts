import { z } from 'zod';
import type { ContentSource, TextFields } from './content-source';

export const translationSchema = z.object({
  entityType: z.enum(['GRAMMAR', 'EXAMPLE', 'RELATION', 'SCENARIO']),
  entityId: z.string().min(1),
  locale: z.literal('en'),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  fields: z.record(z.string(), z.string().max(12000).nullable()),
  status: z.enum(['DRAFT', 'VALIDATED']),
  provenance: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    sourceHash: z.string(),
    method: z.string().min(1),
    requestId: z.string().optional(),
    reviewedBy: z.string().optional(),
    qualityVersion: z.literal('static-en-v1'),
  }),
  validatedAt: z.iso.datetime().nullable(),
});
export type TranslationArtifact = z.infer<typeof translationSchema>;

/** Mechanical checks are necessary, not proof of linguistic correctness. */
export function validateTranslation(
  original: ContentSource,
  fields: TextFields,
): string[] {
  const issues: string[] = [];
  if (
    Object.keys(original.fields).sort().join('|') !==
    Object.keys(fields).sort().join('|')
  )
    issues.push('FIELD_SET_MISMATCH');
  for (const [key, value] of Object.entries(original.fields)) {
    const translated = fields[key];
    if (value === null || value === '') {
      if (translated !== value) issues.push(`${key}:EMPTY_SOURCE_CHANGED`);
      continue;
    }
    if (typeof translated !== 'string' || !translated.trim()) {
      issues.push(`${key}:MISSING`);
      continue;
    }
    // Japanese grammar notation can legitimately remain unchanged.
    const notation = key === 'title' || key === 'connectionRule';
    if (!notation && !/[A-Za-z]{2}/.test(translated))
      issues.push(`${key}:NO_ENGLISH`);
    if (!notation && translated === value && /[\p{Script=Han}]/u.test(value))
      issues.push(`${key}:UNCHANGED_CHINESE`);
    if (/TODO|PLACEHOLDER|translation pending|待翻译|未翻译/i.test(translated))
      issues.push(`${key}:PLACEHOLDER`);
    if (translated.includes('\uFFFD')) issues.push(`${key}:INVALID_UNICODE`);
    if (translated.length > Math.max(100, value.length * 18))
      issues.push(`${key}:EXCESSIVE_EXPANSION`);
  }
  return issues;
}
export function validateArtifact(
  original: ContentSource,
  value: unknown,
): TranslationArtifact {
  const row = translationSchema.parse(value);
  if (
    row.entityId !== original.entityId ||
    row.entityType !== original.entityType ||
    row.sourceHash !== original.sourceHash ||
    row.provenance.sourceHash !== original.sourceHash
  )
    throw new Error('SOURCE_MISMATCH');
  const issues = validateTranslation(original, row.fields);
  if (issues.length) throw new Error(issues.join(', '));
  if (
    row.status === 'VALIDATED' &&
    (!row.validatedAt || !row.provenance.reviewedBy)
  )
    throw new Error('VALIDATION_PROVENANCE_REQUIRED');
  return row;
}
