import { ContentSelectionService } from '../../src/content/content-selection.service';
import { practiceProfile } from '../../src/scenes/grammar-practice-catalog';
import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});
const task = practiceProfile('～かたがた')!.tasks[0];
async function fixture(name: string, forms: [string, string, string][]) {
  const { user } = await h.login(name);
  const entries = await Promise.all(
    forms.map(([word, reading, gloss], index) =>
      h.prisma.vocabularyEntry.create({
        data: {
          ownerId: user.id,
          fingerprint: `${name}-${index}`,
          word,
          reading,
          senseKey: String(index),
          partOfSpeech: [],
          glosses: [{ language: 'eng', text: gloss }],
          level: 'N2',
          sourceName: 'test',
          sourceVersion: '1',
          provenance: {},
          validationStatus: 'VALIDATED',
        },
      }),
    ),
  );
  const select = () =>
    h.app
      .get(ContentSelectionService)
      .selectForPractice(user.id, 'f-N1-0', 'N1', 'selection-test', task);
  return { user, entries, select };
}

test('visit task selects relevant senses with Chinese glosses, not random words or another sense', async () => {
  const f = await fixture('relevant-senses', [
    ['報告', 'ほうこく', 'report'],
    ['挨拶', 'あいさつ', 'greeting'],
    ['挨拶', 'あいさつ', 'reply'],
    ['損失', 'そんしつ', 'loss'],
    ['跳ぶ', 'とぶ', 'to fly'],
  ]);
  const { words } = await f.select();
  expect(words.map((w) => w.word)).toEqual(['報告', '挨拶']);
  expect(words.map((w) => w.chineseGloss)).toEqual([
    '报告；汇报',
    '问候；打招呼',
  ]);
  expect(words[1].id).toBe(f.entries[1].id);
  expect(
    await h.prisma.vocabularyEntry.count({ where: { ownerId: f.user.id } }),
  ).toBe(5);
  expect(
    (
      await h.prisma.vocabularyEntry.findUniqueOrThrow({
        where: { id: f.entries[1].id },
      })
    ).chineseGloss,
  ).toBeNull();
});

test('unrelated bookmarks never widen task vocabulary and duplicate matching senses occupy one slot', async () => {
  const f = await fixture('relevant-bookmarks', [
    ['報告', 'ほうこく', 'report'],
    ['報告', 'ほうこく', 'reporting'],
    ['挨拶', 'あいさつ', 'greeting'],
    ['損失', 'そんしつ', 'loss'],
  ]);
  await h.prisma.vocabularyBookmark.createMany({
    data: f.entries.map((w) => ({ userId: f.user.id, vocabularyId: w.id })),
  });
  const { words } = await f.select();
  expect(words.map((w) => w.word)).toEqual(['報告', '挨拶']);
});

test('wrong reading or unrecognized sense is omitted; no cross-account fallback or quota filling', async () => {
  const f = await fixture('relevant-shortage', [
    ['報告', 'ほうこく', 'report'],
    ['挨拶', 'あいさつ', 'reply'],
    ['挨拶', 'other', 'greeting'],
  ]);
  await fixture('another-owner', [['挨拶', 'あいさつ', 'greeting']]);
  expect((await f.select()).words.map((w) => w.word)).toEqual(['報告']);
  const empty = await fixture('relevant-empty', [['損失', 'そんしつ', 'loss']]);
  expect((await empty.select()).words).toEqual([]);
  expect(
    (
      await h.app
        .get(ContentSelectionService)
        .selectForPractice(f.user.id, 'f-N1-0', 'N1')
    ).words,
  ).toEqual([]);
});
