import { ContentSelectionService } from '../../src/content/content-selection.service';
import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.stop();
});

async function fixture(name: string, forms: [string, string][]) {
  const { user } = await h.login(name);
  const entries = await Promise.all(
    forms.map(([word, reading], index) =>
      h.prisma.vocabularyEntry.create({
        data: {
          ownerId: user.id,
          fingerprint: `${name}-${index}`,
          word,
          reading,
          senseKey: String(index),
          partOfSpeech: [],
          glosses: [],
          level: 'N2',
          sourceName: 'test',
          sourceVersion: '1',
          provenance: {},
          validationStatus: 'VALIDATED',
        },
      }),
    ),
  );
  const select = (sessionId = 'selection-test') =>
    h.app
      .get(ContentSelectionService)
      .selectForPractice(user.id, 'f-N1-0', 'N1', sessionId);
  return { user, entries, select };
}

test('separate senses occupy one slot and the second slot is another word', async () => {
  const f = await fixture('selection-senses', [
    ['地味', 'じみ'],
    ['地味', 'じみ'],
    ['予定', 'よてい'],
  ]);
  for (let i = 0; i < 8; i++) {
    const { words } = await f.select(`session-${i}`);
    expect(words.map((w) => w.word).sort()).toEqual(['予定', '地味'].sort());
  }
  expect(
    await h.prisma.vocabularyEntry.count({ where: { ownerId: f.user.id } }),
  ).toBe(3);
});

test('bookmarked senses cannot fill both slots, including recycling recent content', async () => {
  const f = await fixture('selection-bookmarks', [
    ['地味', 'じみ'],
    ['地味', 'じみ'],
    ['予定', 'よてい'],
  ]);
  await h.prisma.vocabularyBookmark.createMany({
    data: f.entries
      .slice(0, 2)
      .map((w) => ({ userId: f.user.id, vocabularyId: w.id })),
  });
  const session = await h.prisma.studySession.create({
    data: {
      userId: f.user.id,
      grammarId: 'f-N1-0',
      mode: 'PRACTICE',
      timerPhaseEndsAt: new Date(),
    },
  });
  await h.prisma.contentExposure.create({
    data: {
      userId: f.user.id,
      sessionId: session.id,
      contentType: 'VOCABULARY',
      contentId: f.entries[2].id,
      interaction: 'EXPOSED',
    },
  });
  const { words } = await f.select();
  expect(words.map((w) => w.word)).toEqual(['地味', '予定']);
});

test('same spelling with different readings remains distinct', async () => {
  const f = await fixture('selection-readings', [
    ['生物', 'せいぶつ'],
    ['生物', 'なまもの'],
  ]);
  expect((await f.select()).words.map((w) => w.reading).sort()).toEqual(
    ['せいぶつ', 'なまもの'].sort(),
  );
});

test('only one distinct word returns one slot without duplication or cross-account fallback', async () => {
  const f = await fixture('selection-single', [
    ['地味', 'じみ'],
    ['地味', 'じみ'],
  ]);
  await fixture('selection-other-owner', [['予定', 'よてい']]);
  const { words } = await f.select();
  expect(words).toHaveLength(1);
  expect(words[0].ownerId).toBe(f.user.id);
  const empty = await fixture('selection-empty', []);
  expect((await empty.select()).words).toEqual([]);
});
