import { ConfigService } from '@nestjs/config';
import { Injectable, Optional } from '@nestjs/common';
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
    @Optional() private readonly config?: ConfigService,
  ) {}

  async review(
    input: ReviewProviderInput,
  ): Promise<{ provider: AiProvider; response: ProviderResponse }> {
    const preferDeepSeek =
      this.config?.get<string>('AI_PRIMARY_PROVIDER') === 'DEEPSEEK';
    const providers = preferDeepSeek
      ? [this.deepseek, this.gemini]
      : [this.gemini, this.deepseek];
    const names = preferDeepSeek
      ? [AiProvider.DEEPSEEK, AiProvider.GEMINI]
      : [AiProvider.GEMINI, AiProvider.DEEPSEEK];
    for (let index = 0; index < providers.length; index++) {
      try {
        const response = await providers[index].review(input);
        this.assertSuggestions(input.grammarTitle, response);
        return { provider: names[index], response };
      } catch (error) {
        if (
          index === providers.length - 1 ||
          !(error instanceof ProviderError) ||
          !error.retryable
        )
          throw error;
      }
    }
    throw new ProviderError(
      'No AI provider available',
      'AI_NOT_CONFIGURED',
      true,
    );
  }

  private assertSuggestions(title: string, response: ProviderResponse) {
    const result = response.result;
    if (suggestionUsesTargetGrammar(title, result.corrected_sentence)) {
      if (!suggestionUsesTargetGrammar(title, result.alternative_sentence)) {
        result.alternative_sentence = result.corrected_sentence;
        result.alternative_sentence_furigana =
          result.corrected_sentence_furigana;
        result.alternative_sentence_translation_zh =
          result.corrected_sentence_translation_zh;
        result.alternative_sentence_uses_target_grammar = true;
        result.scenario_task_completed = undefined;
      }
      return;
    }
    throw new ProviderError(
      'AI suggestion removed the target grammar',
      'AI_TARGET_GRAMMAR_MISSING',
      true,
    );
  }
}
