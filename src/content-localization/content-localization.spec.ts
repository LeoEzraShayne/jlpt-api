import { grammarSource, exampleSource, source } from './content-source';
import {
  validateTranslation,
  validateArtifact,
} from './translation-validation';
import { ContentLocalizationService } from './content-localization.service';
import type { PrismaService } from '../database/prisma.service';

const grammar = {
  id: 'g1',
  title: '～べく',
  chineseExplanation: '为了……',
  connectionRule: '动词原形＋べく',
};
const original = grammarSource(grammar);
const fields = {
  explanation: 'In order to; a formal written expression of purpose.',
  connectionRule: 'Dictionary form + べく',
  usageScene: null,
  commonErrors: null,
};
describe('static localization integrity', () => {
  it('invalidates translations when any source text or Japanese context changes', () => {
    expect(
      grammarSource({ ...grammar, connectionRule: '新内容' }).sourceHash,
    ).not.toBe(original.sourceHash);
    expect(
      grammarSource({ ...grammar, title: '別の文法' }).sourceHash,
    ).not.toBe(original.sourceHash);
    expect(
      source('GRAMMAR', 'different-id', original.fields, original.context)
        .sourceHash,
    ).toBe(original.sourceHash);
    expect(
      exampleSource({ id: 'e', sentence: '行く', translation: '去' })
        .sourceHash,
    ).not.toBe(
      exampleSource({ id: 'e', sentence: '行かない', translation: '去' })
        .sourceHash,
    );
  });
  it('rejects missing fields, Chinese fallback, fabricated optional text and placeholders', () => {
    expect(validateTranslation(original, fields)).toEqual([]);
    expect(
      validateTranslation(original, { ...fields, explanation: '为了……' }),
    ).toContain('explanation:UNCHANGED_CHINESE');
    expect(
      validateTranslation(original, { ...fields, usageScene: 'Formal' }),
    ).toContain('usageScene:EMPTY_SOURCE_CHANGED');
    expect(validateTranslation(original, { explanation: 'TODO' })).toContain(
      'FIELD_SET_MISMATCH',
    );
  });
  it('requires review provenance before a translation can be published', () => {
    const row = {
      ...original,
      locale: 'en',
      fields,
      status: 'VALIDATED',
      validatedAt: new Date().toISOString(),
      provenance: {
        provider: 'EDITOR',
        model: 'manual',
        sourceHash: original.sourceHash,
        method: 'manual',
        qualityVersion: 'static-en-v1',
      },
    };
    expect(() => validateArtifact(original, row)).toThrow(
      'VALIDATION_PROVENANCE_REQUIRED',
    );
  });
  it('never labels missing or stale Chinese content as English; batches lookups', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ContentLocalizationService({
      contentTranslation: { findMany },
    } as unknown as PrismaService);
    const missing = await service.grammar([grammar], 'en');
    expect(missing[0].localized).toMatchObject({
      resolvedLocale: null,
      status: 'MISSING',
      fields: null,
    });
    findMany.mockResolvedValue([
      { entityType: 'GRAMMAR', entityId: 'g1', sourceHash: 'old', fields },
    ]);
    expect((await service.grammar([grammar], 'en'))[0].localized.status).toBe(
      'STALE',
    );
    findMany.mockResolvedValue([
      {
        entityType: 'GRAMMAR',
        entityId: 'g1',
        sourceHash: original.sourceHash,
        fields,
      },
    ]);
    expect(
      (await service.grammar([grammar], 'en'))[0].localized.fields,
    ).toEqual(fields);
    expect(
      (await service.grammar([grammar], 'zh'))[0].localized.fields,
    ).toEqual(original.fields);
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(missing[0].chineseExplanation).toBe(grammar.chineseExplanation);
  });
});
