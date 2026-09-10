import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import {
  AiGrammarReviewProvider,
  ProviderError,
  type ReviewProviderInput,
} from './ai-provider';
import { buildReviewPrompt } from './prompt';
import {
  assertResponse,
  fetchWithTimeout,
  parseReviewJson,
} from './provider-utils';

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

@Injectable()
export class GeminiReviewProvider implements AiGrammarReviewProvider {
  readonly name = 'GEMINI' as const;
  constructor(private readonly config: ConfigService) {}

  async review(input: ReviewProviderInput) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey)
      throw new ProviderError(
        'Gemini API key is not configured',
        'AI_NOT_CONFIGURED',
        true,
      );
    const model = this.config.get<string>('GEMINI_MODEL', 'gemini-3.5-flash');
    const started = Date.now();
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildReviewPrompt(input) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: geminiReviewJsonSchema,
            thinkingConfig: { thinkingLevel: 'low' },
            temperature: 0.2,
          },
        }),
      },
    );
    const body = await response.text();
    assertResponse(response, body);
    const parsed = z
      .object({
        candidates: z
          .array(
            z.object({
              content: z
                .object({
                  parts: z
                    .array(z.object({ text: z.string().optional() }))
                    .optional(),
                })
                .optional(),
            }),
          )
          .optional(),
        usageMetadata: z
          .object({
            promptTokenCount: z.number().optional(),
            candidatesTokenCount: z.number().optional(),
          })
          .optional(),
      })
      .parse(JSON.parse(body) as unknown);
    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text)
      throw new ProviderError(
        'Gemini response did not contain text',
        'AI_INVALID_RESPONSE',
        true,
      );
    return {
      result: parseReviewJson(text),
      model,
      usage: {
        inputTokens: parsed.usageMetadata?.promptTokenCount,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    };
  }
}
