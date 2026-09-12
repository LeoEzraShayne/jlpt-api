import {
  aiVocabularyInputSchema,
  challengeSchema,
  challengeSchemaFor,
  wordAssessmentSchema,
  type AiVocabularyInput,
  type Challenge,
  type WordAssessment,
} from './vocabulary-ai.schema';

const input: AiVocabularyInput = {
  word: '断る',
  reading: 'ことわる',
  chineseGloss: '拒绝请求',
  senseKey: 'refuse',
  glosses: [{ language: 'eng', text: 'refuse a request' }],
  grammars: [],
  previousPrompts: [],
};
const challenge: Challenge = {
  promptZh: '你已有安排，朋友却邀请你周末帮忙搬家。请礼貌地表示无法接受。',
  meaningHintZh: '表达不接受他人的请求或邀请。',
  grammarId: null,
  referenceSentence: '友達の誘いを断った。',
  referenceFurigana: '友達[ともだち]の誘[さそ]いを断[ことわ]った。',
  referenceTranslationZh: '拒绝了朋友的邀请。',
  chunks: ['友達の', '誘いを', '断った。'],
};
const assessment: WordAssessment = {
  usedTarget: true,
  targetCorrect: true,
  meaningCorrect: true,
  readingCorrect: null,
  explanationZh: '这里的动词正确表达了拒绝邀请的意思。',
  corrections: [],
  correctedSentence: challenge.referenceSentence,
  correctedFurigana: challenge.referenceFurigana,
  correctedTranslationZh: challenge.referenceTranslationZh,
};

describe('vocabulary AI schemas', () => {
  it('exports parsers and inferred contract types', () => {
    expect(aiVocabularyInputSchema.parse(input)).toEqual(input);
    expect(challengeSchemaFor(input).parse(challenge)).toEqual(challenge);
    expect(wordAssessmentSchema.parse(assessment)).toEqual(assessment);
  });

  it('allows only up to five grammar candidates', () => {
    const grammar = {
      id: 'g1',
      title: '〜ても',
      chineseExplanation: '即使',
      connectionRule: null,
    };
    expect(
      aiVocabularyInputSchema.safeParse({ ...input, grammars: [grammar] })
        .success,
    ).toBe(true);
    expect(
      aiVocabularyInputSchema.safeParse({
        ...input,
        grammars: Array.from({ length: 6 }, () => grammar),
      }).success,
    ).toBe(false);
  });

  it.each(['promptZh', 'meaningHintZh'] as const)(
    'conceals spellings and readings in %s',
    (field) => {
      for (const leak of [
        '请使用断る回答。',
        '读音是ことわる。',
        '读音是コトワル。',
        '读音是ｺﾄﾜﾙ。',
      ])
        expect(
          challengeSchemaFor(input).safeParse({ ...challenge, [field]: leak })
            .success,
        ).toBe(false);
      const hanInput = { ...input, word: '拒否', reading: 'きょひ' };
      for (const leak of [
        '请用拒否回答。',
        '请用拒 否回答。',
        '请用拒\u200b否回答。',
      ])
        expect(
          challengeSchemaFor(hanInput).safeParse({
            ...challenge,
            [field]: leak,
          }).success,
        ).toBe(false);
    },
  );

  it('validates grammar selection and avoids repeated prompts', () => {
    expect(
      challengeSchemaFor(input).safeParse({
        ...challenge,
        grammarId: 'invented',
      }).success,
    ).toBe(false);
    const withGrammar = {
      ...input,
      grammars: [{ id: 'g1', title: '〜ても', chineseExplanation: '即使' }],
    };
    expect(
      challengeSchemaFor(withGrammar).safeParse({
        ...challenge,
        grammarId: 'g1',
      }).success,
    ).toBe(true);
    expect(challengeSchemaFor(withGrammar).safeParse(challenge).success).toBe(
      true,
    );
    expect(
      challengeSchemaFor({
        ...input,
        previousPrompts: [challenge.promptZh],
      }).safeParse(challenge).success,
    ).toBe(false);
  });

  it.each([
    '友達の誘[さそ]いを断[ことわ]った。',
    '友達[トモダチ]の誘[さそ]いを断[ことわ]った。',
    '友達[ともだち]の誘[さそ]いを断[ことわ]る。',
    '友達[ともだち]の誘[さそ]いを断[ことわ]った。[',
  ])('rejects incomplete, mismatched or malformed furigana: %s', (furigana) => {
    expect(
      challengeSchema.safeParse({ ...challenge, referenceFurigana: furigana })
        .success,
    ).toBe(false);
    expect(
      wordAssessmentSchema.safeParse({
        ...assessment,
        correctedFurigana: furigana,
      }).success,
    ).toBe(false);
  });

  it('allows whole mixed-script readings following the shared convention', () => {
    expect(
      challengeSchema.safeParse({
        ...challenge,
        referenceFurigana: '友達[ともだち]の誘い[さそい]を断った[ことわった]。',
      }).success,
    ).toBe(true);
  });

  it('requires exact ordered chunk content ignoring punctuation and whitespace', () => {
    expect(
      challengeSchema.safeParse({
        ...challenge,
        chunks: ['友達の ', '誘いを', '断った'],
      }).success,
    ).toBe(true);
    for (const chunks of [
      [],
      ['友達の', '断った'],
      ['断った', '友達の', '誘いを'],
      ['友達の', '誘いを', '断った', '。'],
    ])
      expect(challengeSchema.safeParse({ ...challenge, chunks }).success).toBe(
        false,
      );
  });

  it('allows repeated chunk texts; public IDs are the caller’s responsibility', () => {
    expect(
      challengeSchema.safeParse({
        ...challenge,
        referenceSentence: 'はい、はい。',
        referenceFurigana: 'はい、はい。',
        chunks: ['はい', 'はい'],
      }).success,
    ).toBe(true);
  });

  it('accepts alternate, incorrect and uncertain evidence without promoting it', () => {
    for (const evidence of [
      { usedTarget: false, targetCorrect: null, meaningCorrect: null },
      { usedTarget: true, targetCorrect: false, meaningCorrect: false },
      { usedTarget: true, targetCorrect: null, meaningCorrect: null },
      { usedTarget: true, targetCorrect: false, meaningCorrect: true },
    ])
      expect(
        wordAssessmentSchema.parse({ ...assessment, ...evidence }),
      ).toMatchObject(evidence);
  });

  it('rejects contradictory word success and inferred reading evidence', () => {
    for (const evidence of [
      { usedTarget: false },
      { meaningCorrect: null },
      { meaningCorrect: false },
      { readingCorrect: true },
      { readingCorrect: false },
      { usedTarget: false, targetCorrect: false, meaningCorrect: false },
    ])
      expect(
        wordAssessmentSchema.safeParse({ ...assessment, ...evidence }).success,
      ).toBe(false);
  });

  it('never fills missing evidence from scores or coerces values', () => {
    const missing = { ...assessment, targetCorrect: undefined };
    expect(
      wordAssessmentSchema.safeParse({ ...missing, total_score: 100 }).success,
    ).toBe(false);
    expect(
      wordAssessmentSchema.safeParse({ ...assessment, targetCorrect: 'true' })
        .success,
    ).toBe(false);
    expect(
      wordAssessmentSchema.parse({ ...assessment, total_score: 100 }),
    ).not.toHaveProperty('total_score');
  });

  it('rejects a natural reference that omits the target word', () => {
    const unrelated = {
      ...challenge,
      referenceSentence: 'すみませんが、できません。',
      referenceFurigana: 'すみませんが、できません。',
      referenceTranslationZh: '抱歉，我办不到。',
      chunks: ['すみませんが', 'できません'],
    };
    expect(challengeSchema.safeParse(unrelated).success).toBe(true);
    const checked = challengeSchemaFor(input).safeParse(unrelated);
    expect(checked.success).toBe(false);
    if (!checked.success)
      expect(checked.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['referenceSentence'] }),
        ]),
      );
  });

  it.each([
    ['断る', 'ことわる', 'ことわった'],
    ['断る', 'ことわる', 'コトワリマシタ'],
    ['食べる', 'たべる', 'たべました'],
    ['書く', 'かく', 'かいた'],
    ['泳ぐ', 'およぐ', 'およいだ'],
    ['話す', 'はなす', 'はなした'],
    ['待つ', 'まつ', 'まった'],
    ['死ぬ', 'しぬ', 'しんだ'],
    ['遊ぶ', 'あそぶ', 'あそんだ'],
    ['読む', 'よむ', 'よんだ'],
    ['買う', 'かう', 'かった'],
    ['行く', 'いく', 'いった'],
    ['勉強する', 'べんきょうする', 'べんきょうした'],
    ['来る', 'くる', 'きた'],
    ['高い', 'たかい', 'たかかった'],
    ['報告', 'ほうこく', 'ほうこくします'],
  ])(
    'accepts recognizable conjugated/kana surfaces for %s: %s → %s',
    (word, reading, surface) => {
      const referenceSentence = `もう${surface}。`;
      expect(
        challengeSchemaFor({ ...input, word, reading }).safeParse({
          ...challenge,
          referenceSentence,
          referenceFurigana: referenceSentence,
          chunks: ['もう', surface],
        }).success,
      ).toBe(true);
    },
  );

  it('does not accept a bare verb stem inside an unrelated noun', () => {
    expect(
      challengeSchemaFor({
        ...input,
        word: '食べる',
        reading: 'たべる',
      }).safeParse({
        ...challenge,
        referenceSentence: '食べ物です。',
        referenceFurigana: '食[た]べ物[もの]です。',
        chunks: ['食べ物', 'です'],
      }).success,
    ).toBe(false);
  });

  it('rejects English-only translations, explanations and correction reasons', () => {
    expect(
      challengeSchema.safeParse({
        ...challenge,
        referenceTranslationZh: 'I declined the invitation.',
      }).success,
    ).toBe(false);
    for (const field of ['explanationZh', 'correctedTranslationZh'])
      expect(
        wordAssessmentSchema.safeParse({
          ...assessment,
          [field]: 'The target word is correct.',
        }).success,
      ).toBe(false);
    expect(
      wordAssessmentSchema.safeParse({
        ...assessment,
        corrections: [
          { text: 'が', replacement: 'を', reason: 'Use the object particle.' },
        ],
      }).success,
    ).toBe(false);
  });

  it('allows Japanese quotations inside Chinese feedback', () => {
    expect(
      wordAssessmentSchema.safeParse({
        ...assessment,
        explanationZh: '「断った」正确表达拒绝的意思。',
        corrections: [
          {
            text: 'が',
            replacement: 'を',
            reason: '此处应使用「を」表示宾语。',
          },
        ],
      }).success,
    ).toBe(true);
  });

  it.each([
    'usedTarget=false,targetCorrect,meaningCorrect',
    'readingCorrect=null',
    'used_target=false',
    'ｕｓｅｄＴａｒｇｅｔ',
    'used\u200bTarget',
    'UNVERIFIED',
    'INCORRECT',
    'INDEPENDENT',
    'PROMPTED',
    'total_score=100',
    'grammar_score=30',
    'FSRS',
  ])(
    'rejects implementation leakage in learner-facing fields: %s',
    (technical) => {
      const feedback = `这句话的判定是 ${technical}。`;
      for (const field of ['explanationZh', 'correctedTranslationZh'])
        expect(
          wordAssessmentSchema.safeParse({ ...assessment, [field]: feedback })
            .success,
        ).toBe(false);
      expect(
        wordAssessmentSchema.safeParse({
          ...assessment,
          corrections: [{ text: 'が', replacement: 'を', reason: feedback }],
        }).success,
      ).toBe(false);
    },
  );
});
