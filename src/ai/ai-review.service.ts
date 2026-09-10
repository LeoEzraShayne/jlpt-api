import { Injectable } from '@nestjs/common';
import { AiProvider } from '@prisma/client';
import type { ReviewProviderInput } from './ai-provider';
import { ProviderError } from './ai-provider';
import { DeepSeekReviewProvider } from './deepseek.provider';
import { GeminiReviewProvider } from './gemini.provider';
import type { ProviderResponse } from './review-schema';
import { suggestionUsesTargetGrammar } from './target-grammar';

@Injectable()
export class AiReviewService {
  constructor(
    private readonly gemini: GeminiReviewProvider,
    private readonly deepseek: DeepSeekReviewProvider,
  ) {}

  async review(
    input: ReviewProviderInput,
  ): Promise<{ provider: AiProvider; response: ProviderResponse }> {
    try {
      const response = await this.gemini.review(input);
      this.assertSuggestions(input.grammarTitle, response);
      return {
        provider: AiProvider.GEMINI,
        response,
      };
    } catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable) throw error;
      const response = await this.deepseek.review(input);
      this.assertSuggestions(input.grammarTitle, response);
      return {
        provider: AiProvider.DEEPSEEK,
        response,
      };
    }
  }

  private assertSuggestions(title: string, response: ProviderResponse) {
    const result = response.result;
    if (
      suggestionUsesTargetGrammar(title, result.corrected_sentence) &&
      suggestionUsesTargetGrammar(title, result.alternative_sentence)
    )
      return;
    throw new ProviderError(
      'AI suggestion removed the target grammar',
      'AI_TARGET_GRAMMAR_MISSING',
      true,
    );
  }
}
