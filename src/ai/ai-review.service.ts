import { routeAi } from './ai-routing';
import { PrismaService } from '../database/prisma.service';
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
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async review(
    input: ReviewProviderInput,
  ): Promise<{ provider: AiProvider; response: ProviderResponse }> {
    const ordered =
      this.config?.get<string>('AI_PRIMARY_PROVIDER') === 'DEEPSEEK'
        ? [
            { name: AiProvider.DEEPSEEK, client: this.deepseek },
            { name: AiProvider.GEMINI, client: this.gemini },
          ]
        : [
            { name: AiProvider.GEMINI, client: this.gemini },
            { name: AiProvider.DEEPSEEK, client: this.deepseek },
          ];
    const configured = this.config
      ? ordered.filter((p) => this.config!.get<string>(`${p.name}_API_KEY`))
      : ordered;
    const reviewed = await routeAi(
      configured,
      async (provider, index, feedback) => {
        const response = await provider.client.review({
          ...input,
          validationFeedback: feedback,
          usageContext: {
            ...input.usageContext,
            attempt: (input.usageContext?.attempt ?? 1) + index,
          },
        });
        this.assertSuggestions(input.grammarTitle, response);
        return response;
      },
      this.config,
      this.prisma,
    );
    return { provider: reviewed.provider.name, response: reviewed.response };
  }

  private assertSuggestions(title: string, response: ProviderResponse) {
    const result = response.result;
    if (suggestionUsesTargetGrammar(title, result.corrected_sentence)) {
      if (
        result.alternative_sentence &&
        !suggestionUsesTargetGrammar(title, result.alternative_sentence)
      ) {
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
