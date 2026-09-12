import { validateReviewLanguage } from './review-language';
import { buildReviewPrompt } from './prompt';
import {
  challengeSchemaFor,
  wordAssessmentSchemaForLocale,
} from '../vocabulary-learning/vocabulary-ai.schema';
const input = {
  explanationLocale: 'en' as const,
  word: '報告',
  reading: 'ほうこく',
  chineseGloss: '汇报',
  senseKey: 'report',
  glosses: [{ language: 'eng', text: 'report' }],
  grammars: [],
  previousPrompts: [],
};
const challenge = {
  promptZh: 'Tell your colleague what you will do at tomorrow’s meeting.',
  meaningHintZh: 'Give someone an account of what happened.',
  grammarId: null,
  referenceSentence: '結果を報告します。',
  referenceFurigana: '結果[けっか]を報告[ほうこく]します。',
  referenceTranslationZh: 'I will report the results.',
  chunks: ['結果を', '報告します。'],
};
describe('session language and Japanese task boundary', () => {
  it('uses frozen English locale while preserving Japanese target and original data', () => {
    const prompt = buildReviewPrompt({
      stage: 'CORE',
      explanationLocale: 'en',
      grammarTitle: '～ながら',
      explanation: '同时进行',
      sentence: '音楽を聞きながら料理をします。',
    });
    expect(prompt).toContain('MUST be natural English');
    expect(prompt).toContain('音楽を聞きながら料理をします。');
    expect(prompt).toContain('original character by character');
  });
  it('validates real English and rejects Chinese fallback and English-answer instructions', () => {
    expect(challengeSchemaFor(input).safeParse(challenge).success).toBe(true);
    for (const promptZh of [
      '请向同事说明你的计划。',
      'In English, say that you will give a report.',
      'Write your answer in English.',
    ])
      expect(
        challengeSchemaFor(input).safeParse({ ...challenge, promptZh }).success,
      ).toBe(false);
  });
  it('accepts English correction language and preserves target evidence constraints', () => {
    const assessment = {
      usedTarget: true,
      targetCorrect: false,
      meaningCorrect: false,
      readingCorrect: null,
      explanationZh:
        'A report cannot be eaten. Use a food word to express your intended meaning.',
      corrections: [
        {
          text: '報告',
          replacement: 'ご飯',
          reason: 'Rice is something you can eat.',
        },
      ],
      correctedSentence: 'ご飯を食べました。',
      correctedFurigana: 'ご飯[はん]を食[た]べました。',
      correctedTranslationZh: 'I ate rice.',
    };
    expect(
      wordAssessmentSchemaForLocale('en').safeParse(assessment).success,
    ).toBe(true);
    expect(
      wordAssessmentSchemaForLocale('en').safeParse({
        ...assessment,
        usedTarget: false,
      }).success,
    ).toBe(false);
    expect(
      wordAssessmentSchemaForLocale('en').safeParse({
        ...assessment,
        explanationZh: '报告不能作为吃的对象。',
      }).success,
    ).toBe(false);
  });
});

it('repairs a unique literal error span offset and rejects silent correctness changes', () => {
  const result = {
    total_score: 50,
    grammar_score: 10,
    connection_score: 0,
    completeness_score: 20,
    naturalness_score: 10,
    vocabulary_score: 10,
    is_correct: false,
    used_target_grammar: true,
    target_grammar_correct: false,
    result_level: 'INCORRECT' as const,
    error_spans: [
      {
        text: '聞くながら',
        start: 4,
        end: 9,
        reason: 'Use the verb stem.',
        replacement: '聞きながら',
      },
    ],
    corrected_sentence: '音楽を聞きながら料理をします。',
    corrected_sentence_furigana:
      '音楽[おんがく]を聞[き]きながら料理[りょうり]をします。',
    corrected_sentence_translation_zh: 'I cook while listening to music.',
    corrected_sentence_uses_target_grammar: true as const,
    explanation_zh: 'Use the verb stem.',
    encouragement: 'Keep practicing.',
  };
  const input = {
    grammarTitle: '～ながら',
    explanation: 'simultaneous actions',
    sentence: '音楽を聞くながら料理をします。',
    explanationLocale: 'en' as const,
  };
  validateReviewLanguage(result, input);
  expect(result.error_spans[0]).toMatchObject({ start: 3, end: 8 });
  expect(() =>
    validateReviewLanguage(
      { ...result, is_correct: true, target_grammar_correct: true },
      input,
    ),
  ).toThrow('silently corrected');
  expect(() =>
    validateReviewLanguage(
      {
        ...result,
        error_spans: [{ ...result.error_spans[0], start: 0, end: 1 }],
      },
      { ...input, sentence: input.sentence + input.sentence },
    ),
  ).toThrow('unambiguous');
});
