import type { ReviewProviderInput } from './ai-provider';
import { localizedCoreReviewPrompt } from './review-language';

/** One instruction scaffold for both languages; session locale controls feedback. */
export function progressivePrompt(input: ReviewProviderInput) {
  return localizedCoreReviewPrompt(input);
}
