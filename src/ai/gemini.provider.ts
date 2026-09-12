import { withValidationFeedback } from './bounded-ai-attempts';
import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import {
  AiGrammarReviewProvider,
  type ReviewProviderInput,
} from './ai-provider';
import { buildReviewPrompt } from './prompt';
import { parseReviewJson } from './provider-utils';
import { geminiJsonSchema } from './gemini-json-schema';
import { MeteredAiClient } from './metered-ai-client';
import { validateReviewLanguage } from './review-language';

@Injectable()
export class GeminiReviewProvider implements AiGrammarReviewProvider {
  readonly name = 'GEMINI' as const;
  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}
  async review(input: ReviewProviderInput) {
    return new MeteredAiClient(this.config, this.prisma).request(
      this.name,
      withValidationFeedback(
        buildReviewPrompt(input),
        input.validationFeedback,
        input.explanationLocale,
      ),
      'GRAMMAR_REVIEW',
      input.usageContext ?? {},
      (text) => {
        const result = parseReviewJson(text, input.stage === 'CORE');
        validateReviewLanguage(result, input);
        return result;
      },
      geminiJsonSchema(input.stage),
    );
  }
}
