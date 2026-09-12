import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  correctedSnapshot,
  guardedState,
  recordHash,
  sourceCorrectionSchema,
} from './source-correction';
const artifact = sourceCorrectionSchema.parse(
  JSON.parse(
    readFileSync(
      join(
        __dirname,
        '../../scripts/content-localization/corrections/F-language-20260913.json',
      ),
      'utf8',
    ),
  ),
);
describe('reviewed source correction safety', () => {
  it('includes timestamps in verification fingerprints', () => {
    expect(recordHash({ at: new Date('2026-01-01') })).not.toBe(
      recordHash({ at: new Date('2026-01-02') }),
    );
  });
  it('recognizes exact before/after but rejects any unknown content drift', () => {
    for (const patch of artifact.sourcePatches) {
      expect(guardedState(patch.before, patch.before, patch.after)).toBe(
        'PENDING',
      );
      expect(guardedState(patch.after, patch.before, patch.after)).toBe(
        'ALREADY_APPLIED',
      );
      expect(() =>
        guardedState(
          { ...patch.before, id: 'different' },
          patch.before,
          patch.after,
        ),
      ).toThrow('SOURCE_DRIFT');
      expect(recordHash(patch.before)).toBe(patch.beforeRecordHash);
      expect(recordHash(patch.after)).toBe(patch.afterRecordHash);
    }
  });
  it('patches a copy, retains unrelated records and guards all source fields', () => {
    const input: Record<string, Record<string, unknown>[]> = {
      GrammarPoint: [],
      GrammarExample: [],
    };
    for (const p of artifact.sourcePatches)
      input[p.table].push({ ...p.before });
    input.GrammarPoint.push({ id: 'untouched', title: 'untouched' });
    const originalHash = recordHash(input);
    const result = correctedSnapshot(input, artifact);
    expect(recordHash(input)).toBe(originalHash);
    expect(result.GrammarPoint.at(-1)).toEqual(input.GrammarPoint.at(-1));
    expect(correctedSnapshot(result, artifact)).toEqual(result);
    input.GrammarPoint[0].connectionRule = 'unknown edit';
    expect(() => correctedSnapshot(input, artifact)).toThrow('SOURCE_DRIFT');
  });
  it('preserves IDs and stores old English and source hashes alongside the correction', () => {
    expect(artifact.sourcePatches).toHaveLength(5);
    expect(artifact.translationEdits).toHaveLength(5);
    const example = artifact.sourcePatches.find(
      (p) => p.table === 'GrammarExample',
    )!;
    expect(example.after.id).toBe(example.before.id);
    expect(example.after.grammarId).toBe(example.before.grammarId);
    expect(example.after.sentence).toContain('引き受けないわけにはいかない');
    for (const edit of artifact.translationEdits)
      expect(edit.before.entityId).toBe(edit.after.entityId);
  });
});
