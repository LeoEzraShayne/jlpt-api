import type { ProviderResponse } from './review-schema';

export interface ReviewProviderInput {
  grammarLevel?: string;
  grammarTitle: string;
  explanation: string;
  connectionRule?: string | null;
  exampleSentence?: string;
  sentence: string;
  scene?: string | null;
}

export interface AiGrammarReviewProvider {
  readonly name: 'GEMINI' | 'DEEPSEEK';
  review(input: ReviewProviderInput): Promise<ProviderResponse>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}
