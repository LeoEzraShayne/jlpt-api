import { z } from 'zod';
import { validFurigana } from '../ai/review-schema';

const text = z.string().trim().min(1);
// Feedback may quote Japanese, but must not be an English-only response.
const chineseContent = text.refine(
  (value) => /\p{Script=Han}/u.test(value),
  'Chinese text must contain Han characters',
);
const chineseText = chineseContent.refine(
  (value) => !/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value),
  'Use Chinese without Japanese spellings or readings',
);
const learnerFeedback = chineseContent.refine(
  (value) =>
    !/(?:used_?target|target_?correct|meaning_?correct|reading_?correct|explanation_?zh|corrected_?(?:sentence|furigana|translation_?zh)|total_?score|grammar_?score|\b(?:INDEPENDENT|PROMPTED|INCORRECT|UNVERIFIED|FSRS|corrections|true|false|null)\b)/iu.test(
      value.normalize('NFKC').replace(/\p{Cf}/gu, ''),
    ),
  'Feedback must use learner-facing language, not API fields or internal results',
);

export const aiVocabularyInputSchema = z.object({
  word: text,
  reading: text,
  chineseGloss: text,
  senseKey: text,
  glosses: z.array(z.object({ language: text, text })),
  grammars: z
    .array(
      z.object({
        id: text,
        title: text,
        chineseExplanation: text,
        connectionRule: text.nullable().optional(),
      }),
    )
    .max(5),
  previousPrompts: z.array(text),
});

// Match the existing kanji[hiragana] convention, additionally rejecting stray
// brackets (the shared helper intentionally only checks kanji coverage).
function fullFurigana(sentence: string, annotated: string) {
  return (
    !/[[\]［］]/u.test(sentence) &&
    validFurigana(sentence, annotated) &&
    !/[[\]［］]/u.test(
      annotated.replace(
        /([\p{Script=Han}々〆ヶ]+[\p{Script=Hiragana}]*)\[([\p{Script=Hiragana}ー]+)\]/gu,
        '$1',
      ),
    )
  );
}

// Providers sometimes insert visual separators between ruby groups. Repair only
// whitespace when every actual sentence character already matches exactly.
function normalizeAnnotationSpacing(sentence: string, annotated: string) {
  if (/\s/u.test(sentence)) return annotated;
  const plain = annotated.replace(/\[[^\]]+\]/g, '');
  return plain.replace(/\s/gu, '') === sentence
    ? annotated.replace(/\s/gu, '')
    : annotated;
}

function chunkContent(value: string) {
  return value.replace(/[\p{P}\s]/gu, '');
}

export const challengeSchema = z
  .object({
    promptZh: chineseText,
    meaningHintZh: chineseText,
    grammarId: text.nullable(),
    referenceSentence: text,
    referenceFurigana: text,
    referenceTranslationZh: chineseContent,
    chunks: z
      .array(text.refine((value) => chunkContent(value).length > 0))
      .min(2)
      .max(40),
  })
  .transform((value) => ({
    ...value,
    referenceFurigana: normalizeAnnotationSpacing(
      value.referenceSentence,
      value.referenceFurigana,
    ),
  }))
  .superRefine((value, context) => {
    if (!fullFurigana(value.referenceSentence, value.referenceFurigana))
      context.addIssue({
        code: 'custom',
        path: ['referenceFurigana'],
        message: 'Complete, matching hiragana annotations are required',
      });
    if (
      chunkContent(value.chunks.join('')) !==
      chunkContent(value.referenceSentence)
    )
      context.addIssue({
        code: 'custom',
        path: ['chunks'],
        message:
          'Ordered chunks must reconstruct the reference modulo punctuation and whitespace',
      });
  });

export const wordAssessmentSchema = z
  .object({
    usedTarget: z.boolean(),
    targetCorrect: z.boolean().nullable(),
    meaningCorrect: z.boolean().nullable(),
    readingCorrect: z.null(),
    explanationZh: learnerFeedback,
    corrections: z.array(
      z.object({
        text: z.string(),
        replacement: z.string(),
        reason: learnerFeedback,
      }),
    ),
    correctedSentence: text,
    correctedFurigana: text,
    correctedTranslationZh: learnerFeedback,
  })
  .transform((value) => ({
    ...value,
    correctedFurigana: normalizeAnnotationSpacing(
      value.correctedSentence,
      value.correctedFurigana,
    ),
  }))
  .superRefine((value, context) => {
    if (
      !value.usedTarget &&
      (value.targetCorrect !== null || value.meaningCorrect !== null)
    )
      context.addIssue({
        code: 'custom',
        path: ['usedTarget'],
        message:
          'Absent target gives no evidence about target correctness or meaning',
      });
    if (value.targetCorrect === true && value.meaningCorrect !== true)
      context.addIssue({
        code: 'custom',
        path: ['targetCorrect'],
        message: 'Target success requires verified current-sense meaning',
      });
    if (!fullFurigana(value.correctedSentence, value.correctedFurigana))
      context.addIssue({
        code: 'custom',
        path: ['correctedFurigana'],
        message: 'Complete, matching hiragana annotations are required',
      });
  });

export type Challenge = z.infer<typeof challengeSchema>;
export type WordAssessment = z.infer<typeof wordAssessmentSchema>;
export type AiVocabularyInput = z.infer<typeof aiVocabularyInputSchema>;

function concealedText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{Z}\p{Cf}\s]/gu, '');
}

function normalizeJapanese(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/gu, (kana) =>
      String.fromCharCode(kana.charCodeAt(0) - 0x60),
    );
}

// Conservative lexical guard, not a morphological or sense analyzer. Require
// a surface form or recognizable inflection, never just a bare verb stem.
// Without part-of-speech data, る permits both godan and ichidan possibilities.
const godanEndings: Record<string, string> = {
  う: 'わない わなかった われ わせ います いません いました って った えば える おう',
  く: 'かない かなかった かれ かせ きます きません きました いて いた けば ける こう',
  ぐ: 'がない がなかった がれ がせ ぎます ぎません ぎました いで いだ げば げる ごう',
  す: 'さない さなかった され させ します しません しました して した せば せる そう',
  つ: 'たない たなかった たれ たせ ちます ちません ちました って った てば てる とう',
  ぬ: 'なない ななかった なれ なせ にます にません にました んで んだ ねば ねる のう',
  ぶ: 'ばない ばなかった ばれ ばせ びます びません びました んで んだ べば べる ぼう',
  む: 'まない まなかった まれ ませ みます みません みました んで んだ めば める もう',
  る: 'らない らなかった られ らせ ります りません りました って った れば れる ろう',
};

function lexicalSurfaces(value: string) {
  const word = normalizeJapanese(value);
  const surfaces = [word];
  const stem = word.slice(0, -1);
  const add = (base: string, endings: string) => {
    for (const ending of endings.split(' ').filter(Boolean))
      surfaces.push(base + ending);
  };
  if (stem) {
    add(stem, godanEndings[word.slice(-1)] ?? '');
    if (word.endsWith('る'))
      add(
        stem,
        'ない なかった ます ません ました て た られる させる れば よう',
      );
    if (word.endsWith('い')) add(stem, 'く かった ければ');
  }
  if (word.endsWith('する'))
    add(
      word.slice(0, -2),
      'しない しなかった します しません しました して した される させる できる すれば しよう',
    );
  if (word.endsWith('くる'))
    add(
      word.slice(0, -2),
      'きた きて きます きません きました こない こなかった こられる こよう',
    );
  if (word === '行く' || word === 'いく' || word === 'ゆく')
    add(stem, 'って った');
  return surfaces;
}

/** Validation tied to the particular sense and allowed grammar candidates. */
export function challengeSchemaFor(input: AiVocabularyInput) {
  return challengeSchema.superRefine((value, context) => {
    const reference = normalizeJapanese(value.referenceSentence);
    if (
      ![input.word, input.reading]
        .flatMap(lexicalSurfaces)
        .some((surface) => reference.includes(surface))
    )
      context.addIssue({
        code: 'custom',
        path: ['referenceSentence'],
        message:
          'Reference must contain the target spelling, reading or a recognizable conjugation',
      });
    for (const field of ['promptZh', 'meaningHintZh'] as const) {
      const visible = concealedText(value[field]);
      if (
        [input.word, input.reading].some((target) => {
          const hidden = concealedText(target);
          return hidden.length > 0 && visible.includes(hidden);
        })
      )
        context.addIssue({
          code: 'custom',
          path: [field],
          message:
            'Prompt and first hint must conceal the target word and reading',
        });
    }
    if (
      value.grammarId !== null &&
      !input.grammars.some((grammar) => grammar.id === value.grammarId)
    )
      context.addIssue({
        code: 'custom',
        path: ['grammarId'],
        message: 'Only supplied grammar candidates may be selected',
      });
    if (
      input.previousPrompts.some(
        (prompt) => concealedText(prompt) === concealedText(value.promptZh),
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['promptZh'],
        message: 'Use a new scenario',
      });
  });
}
