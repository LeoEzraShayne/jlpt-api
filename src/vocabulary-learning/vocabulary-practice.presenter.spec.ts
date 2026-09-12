import {
  presentPractice,
  shuffledChunks,
} from './vocabulary-practice.presenter';
import {
  assessment,
  challenge,
  makePractice,
} from './vocabulary-test-fixtures';

describe('public practice secrecy', () => {
  it.each(['QUEUED', 'GENERATING', 'READY', 'ASSESSING', 'FAILED'])(
    'never exposes hidden target/reference/internal JSON in %s',
    (status) => {
      const value = presentPractice(makePractice({ status }));
      expect(value).not.toHaveProperty('reference');
      expect(value).not.toHaveProperty('challenge');
      expect(value).not.toHaveProperty('learning');
      expect(value).not.toHaveProperty('userId');
      expect(value).not.toHaveProperty('assessment');
      const json = JSON.stringify(value);
      for (const secret of [
        '着く',
        'つく',
        challenge.referenceSentence,
        '_input',
        'senseKey',
        'memoryCard',
      ])
        expect(json).not.toContain(secret);
    },
  );
  it.each([0, 1, 2, 3, 4])('reveals exactly hint level %s', (hintLevel) => {
    const { hints } = presentPractice(makePractice({ hintLevel }));
    expect(!!hints.meaning).toBe(hintLevel >= 1);
    expect(!!hints.reading).toBe(hintLevel >= 2);
    expect(!!hints.word).toBe(hintLevel >= 3);
    expect(!!hints.chunks).toBe(hintLevel >= 4);
  });
  it('exposes the explicit unknown learning preview only for initial unknowns', () => {
    expect(
      presentPractice(makePractice({ unknownAtStart: true })),
    ).toHaveProperty(
      'learningPreview',
      expect.objectContaining({
        word: '着く',
        exampleSentence: challenge.referenceSentence,
      }),
    );
    expect(presentPractice(makePractice())).not.toHaveProperty(
      'learningPreview',
    );
  });
  it.each(['ASSESSING', 'FAILED', 'COMPLETED'])(
    'shows the immutable own answer in %s without early reference',
    (status) => {
      const value = presentPractice(
        makePractice({
          status,
          answer: '自分の文',
          assessment: status === 'COMPLETED' ? assessment : null,
        }),
      );
      expect(value).toHaveProperty('answer', '自分の文');
      expect('reference' in value).toBe(status === 'COMPLETED');
    },
  );
  it('keeps the intentional grammar instruction visible', () => {
    expect(
      presentPractice(
        makePractice({
          grammar: {
            id: 'grammar',
            title: '〜から',
            level: 'N4',
            chineseExplanation: '表示原因',
            connectionRule: null,
            usageScene: null,
            commonErrors: null,
            sortOrder: 1,
            status: 'PUBLISHED',
            sourceDataset: 'test',
            sourceOrdinal: 1,
            sourceHash: 'test',
            createdAt: new Date(0),
            updatedAt: new Date(0),
          },
          grammarId: 'grammar',
        }),
      ),
    ).toHaveProperty('grammar', { id: 'grammar', title: '〜から' });
  });
  it('whitelists completed feedback and never invents observable reading evidence', () => {
    const result = presentPractice(
      makePractice({
        status: 'COMPLETED',
        assessment: {
          ...assessment,
          readingCorrect: true,
          secret: 'do not expose',
          corrections: [
            { text: 'a', replacement: 'b', reason: 'c', rawPrompt: 'secret' },
          ],
        },
      }),
    );
    expect(result).toHaveProperty('result.readingCorrect', null);
    expect(result).toHaveProperty('result.outcome', 'INDEPENDENT');
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toHaveProperty(
      'reference.sentence',
      challenge.referenceSentence,
    );
  });
  it('uses stable opaque occurrence IDs and preserves every chunk, including repetitions', () => {
    const chunks = ['私', 'は', '私', 'です'];
    const shuffled = shuffledChunks('one-practice', chunks);
    expect(shuffled).toEqual(shuffledChunks('one-practice', chunks));
    expect(new Set(shuffled.map((c) => c.id)).size).toBe(4);
    expect(shuffled.map((c) => c.text).sort()).toEqual([...chunks].sort());
    for (const chunk of shuffled) expect(chunk.id).toMatch(/^[a-f0-9]{20}$/);
    expect(shuffled).not.toEqual(shuffledChunks('other-practice', chunks));
  });
});

it('English aliases obey the exact same hint/reference gates and retain the snapshot', () => {
  const englishChallenge = {
    ...challenge,
    promptZh: 'Explain when you arrived.',
    meaningHintZh: 'Reach your destination.',
    referenceTranslationZh: 'I arrived at the station.',
  };
  for (const hintLevel of [0, 1, 2, 3, 4]) {
    const value = presentPractice(
      makePractice({
        explanationLocale: 'en',
        challenge: englishChallenge,
        hintLevel,
      }),
    );
    expect(value).toHaveProperty('explanationLocale', 'en');
    expect(value).toHaveProperty('localized.prompt', englishChallenge.promptZh);
    expect(value).not.toHaveProperty('localized.referenceTranslation');
    expect('localized' in value && 'meaningHint' in value.localized).toBe(
      hintLevel >= 1,
    );
  }
  const done = presentPractice(
    makePractice({
      explanationLocale: 'en',
      challenge: englishChallenge,
      status: 'COMPLETED',
      assessment: {
        ...assessment,
        explanationZh: 'The word fits this context.',
        correctedTranslationZh: 'I arrived at the station.',
      },
    }),
  );
  expect(done).toHaveProperty('result.localizedFeedback.locale', 'en');
  expect(done).toHaveProperty(
    'reference.translationZh',
    englishChallenge.referenceTranslationZh,
  );
  expect(done).toHaveProperty(
    'localized.referenceTranslation',
    englishChallenge.referenceTranslationZh,
  );
});
