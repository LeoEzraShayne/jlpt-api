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

import { geminiJsonSchema } from './gemini-json-schema';

@Injectable()
export class GeminiReviewProvider implements AiGrammarReviewProvider {
  readonly name = 'GEMINI' as const;
  constructor(private readonly config: ConfigService) {}

  async review(input: ReviewProviderInput) {
    const response = await this.generate(input);
    return {
      ...response,
      result: parseReviewJson(response.text, input.stage === 'CORE'),
    };
  }

  private async generate(input: ReviewProviderInput) {
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
            responseJsonSchema: geminiJsonSchema(input.stage),
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
      text,
      model,
      usage: {
        inputTokens: parsed.usageMetadata?.promptTokenCount,
        outputTokens: parsed.usageMetadata?.candidatesTokenCount,
      },
      latencyMs: Date.now() - started,
    };
  }
}
