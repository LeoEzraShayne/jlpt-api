const geminiReviewJsonSchema = {
  type: 'object',
  properties: {
    total_score: { type: 'integer', minimum: 0, maximum: 100 },
    grammar_score: { type: 'integer', minimum: 0, maximum: 30 },
    connection_score: { type: 'integer', minimum: 0, maximum: 20 },
    completeness_score: { type: 'integer', minimum: 0, maximum: 20 },
    naturalness_score: { type: 'integer', minimum: 0, maximum: 20 },
    vocabulary_score: { type: 'integer', minimum: 0, maximum: 10 },
    is_correct: { type: 'boolean' },
    used_target_grammar: { type: 'boolean' },
    target_grammar_correct: { type: 'boolean' },
    result_level: {
      type: 'string',
      enum: ['CORRECT', 'MOSTLY_CORRECT', 'NEEDS_REVISION', 'INCORRECT'],
    },
    error_spans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          start: { type: 'integer', minimum: 0 },
          end: { type: 'integer', minimum: 0 },
          reason: { type: 'string' },
          replacement: { type: 'string' },
        },
        required: ['text', 'start', 'end', 'reason', 'replacement'],
        additionalProperties: false,
      },
    },
    corrected_sentence: { type: 'string' },
    corrected_sentence_furigana: { type: 'string' },
    corrected_sentence_translation_zh: { type: 'string' },
    corrected_sentence_uses_target_grammar: { type: 'boolean' },
    alternative_sentence: { type: 'string' },
    alternative_sentence_uses_target_grammar: { type: 'boolean' },
    alternative_sentence_furigana: { type: 'string' },
    alternative_sentence_translation_zh: { type: 'string' },
    explanation_zh: { type: 'string' },
    encouragement: { type: 'string' },
    content_response: { type: 'string', maxLength: 300 },
    diversity_advice: { type: 'string', maxLength: 400 },
    next_practice: { type: 'string', maxLength: 400 },
    scenario_task_completed: { type: 'boolean' },
  },
  required: [
    'total_score',
    'grammar_score',
    'connection_score',
    'completeness_score',
    'naturalness_score',
    'vocabulary_score',
    'is_correct',
    'used_target_grammar',
    'target_grammar_correct',
    'result_level',
    'error_spans',
    'corrected_sentence',
    'corrected_sentence_furigana',
    'corrected_sentence_translation_zh',
    'corrected_sentence_uses_target_grammar',
    'alternative_sentence',
    'alternative_sentence_uses_target_grammar',
    'alternative_sentence_furigana',
    'alternative_sentence_translation_zh',
    'explanation_zh',
    'encouragement',
    'content_response',
    'diversity_advice',
    'next_practice',
    'scenario_task_completed',
  ],
  additionalProperties: false,
} as const;

const extensionKeys = new Set([
  'alternative_sentence',
  'alternative_sentence_uses_target_grammar',
  'alternative_sentence_furigana',
  'alternative_sentence_translation_zh',
  'content_response',
  'diversity_advice',
  'next_practice',
]);
export function geminiJsonSchema(stage?: 'CORE') {
  if (!stage) return geminiReviewJsonSchema;
  const keys = Object.keys(geminiReviewJsonSchema.properties).filter(
    (key) => !extensionKeys.has(key),
  );
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(geminiReviewJsonSchema.properties).filter(([key]) =>
        keys.includes(key),
      ),
    ),
    required: geminiReviewJsonSchema.required.filter((key) =>
      keys.includes(key),
    ),
    additionalProperties: false,
  };
}
