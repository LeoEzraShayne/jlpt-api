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

@Injectable()
export class DeepSeekReviewProvider implements AiGrammarReviewProvider {
  readonly name = 'DEEPSEEK' as const;
  constructor(private readonly config: ConfigService) {}

  async review(input: ReviewProviderInput) {
    const apiKey = this.config.get<string>('DEEPSEEK_API_KEY');
    if (!apiKey)
      throw new ProviderError(
        'DeepSeek API key is not configured',
        'AI_NOT_CONFIGURED',
        false,
      );
    const model = this.config.get<string>('DEEPSEEK_MODEL', 'deepseek-chat');
    const started = Date.now();
    const response = await fetchWithTimeout(
      'https://api.deepseek.com/chat/completions',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildReviewPrompt(input) }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
        }),
      },
    );
    const body = await response.text();
    assertResponse(response, body);
    const parsed = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({ content: z.string().optional() }).optional(),
            }),
          )
          .optional(),
        usage: z
          .object({
            prompt_tokens: z.number().optional(),
            completion_tokens: z.number().optional(),
          })
          .optional(),
      })
      .parse(JSON.parse(body) as unknown);
    const text = parsed.choices?.[0]?.message?.content;
    if (!text)
      throw new ProviderError(
        'DeepSeek response did not contain text',
        'AI_INVALID_RESPONSE',
        true,
      );
    return {
      result: parseReviewJson(text),
      model,
      usage: {
        inputTokens: parsed.usage?.prompt_tokens,
        outputTokens: parsed.usage?.completion_tokens,
      },
      latencyMs: Date.now() - started,
    };
  }
}
