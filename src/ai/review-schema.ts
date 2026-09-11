import { z } from 'zod';

const errorSpanSchema = z.object({
  text: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  reason: z.string(),
  replacement: z.string(),
});

const reviewFields = z.object({
  total_score: z.number().int().min(0).max(100),
  grammar_score: z.number().int().min(0).max(30),
  connection_score: z.number().int().min(0).max(20),
  completeness_score: z.number().int().min(0).max(20),
  naturalness_score: z.number().int().min(0).max(20),
  vocabulary_score: z.number().int().min(0).max(10),
  is_correct: z.boolean(),
  used_target_grammar: z.boolean(),
  target_grammar_correct: z.boolean(),
  result_level: z.enum([
    'CORRECT',
    'MOSTLY_CORRECT',
    'NEEDS_REVISION',
    'INCORRECT',
  ]),
  error_spans: z
    .array(errorSpanSchema)
    .transform((spans) =>
      spans.filter((span) => span.text.trim() !== span.replacement.trim()),
    ),
  corrected_sentence: z.string(),
  corrected_sentence_furigana: z.string().min(1),
  corrected_sentence_translation_zh: z.string().min(1),
  corrected_sentence_uses_target_grammar: z.literal(true),
  alternative_sentence: z.string().min(1),
  alternative_sentence_uses_target_grammar: z.literal(true),
  alternative_sentence_furigana: z.string().min(1),
  alternative_sentence_translation_zh: z.string().min(1),
  explanation_zh: z.string(),
  encouragement: z.string(),
  content_response: z
    .string()
    .max(300)
    .refine(
      (text) =>
        text.split(/[。！？!?]+/u).filter((part) => part.trim()).length <= 2,
      'Content response must contain at most two sentences',
    )
    .optional(),
  diversity_advice: z.string().max(400).optional(),
  next_practice: z.string().max(400).optional(),
  scenario_task_completed: z.boolean().optional(),
});

export const coreReviewFields = reviewFields.omit({
  alternative_sentence: true,
  alternative_sentence_furigana: true,
  alternative_sentence_translation_zh: true,
  alternative_sentence_uses_target_grammar: true,
  content_response: true,
  diversity_advice: true,
  next_practice: true,
});
export const coreReviewSchema = coreReviewFields.superRefine(
  (value, context) => {
    const componentTotal =
      value.grammar_score +
      value.connection_score +
      value.completeness_score +
      value.naturalness_score +
      value.vocabulary_score;
    if (componentTotal !== value.total_score)
      context.addIssue({
        code: 'custom',
        path: ['total_score'],
        message: 'Total score must equal the component score sum',
      });
    if (value.target_grammar_correct && !value.used_target_grammar)
      context.addIssue({
        code: 'custom',
        path: ['target_grammar_correct'],
        message: 'Target grammar cannot be correct when it was not used',
      });
    if (
      !validFurigana(
        value.corrected_sentence,
        value.corrected_sentence_furigana,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['corrected_sentence_furigana'],
        message:
          'Every corrected sentence kanji group must have a hiragana reading',
      });
  },
);

export const providerReviewSchema = reviewFields.superRefine(
  (value, context) => {
    const core = coreReviewSchema.safeParse(value);
    if (!core.success)
      for (const issue of core.error.issues)
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
    if (
      !validFurigana(
        value.alternative_sentence,
        value.alternative_sentence_furigana,
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['alternative_sentence_furigana'],
        message: 'Every kanji group must have a hiragana reading',
      });
  },
);

const kanjiPattern = /[\p{Script=Han}々〆ヶ]/u;
const annotationPattern =
  /([\p{Script=Han}々〆ヶ]+[\p{Script=Hiragana}]*)\[([\p{Script=Hiragana}ー]+)\]/gu;

export function validFurigana(sentence: string, annotated: string) {
  const plain = annotated.replace(/\[[^\]]+\]/g, '');
  if (plain !== sentence) return false;
  const withoutAnnotations = annotated.replace(annotationPattern, '');
  return !kanjiPattern.test(withoutAnnotations);
}

export type ProviderReview = z.infer<typeof coreReviewSchema> &
  Partial<
    Pick<
      z.infer<typeof reviewFields>,
      | 'alternative_sentence'
      | 'alternative_sentence_furigana'
      | 'alternative_sentence_translation_zh'
      | 'alternative_sentence_uses_target_grammar'
      | 'content_response'
      | 'diversity_advice'
      | 'next_practice'
    >
  >;
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
}
export interface ProviderResponse {
  result: ProviderReview;
  model: string;
  usage: ProviderUsage;
  latencyMs: number;
}
