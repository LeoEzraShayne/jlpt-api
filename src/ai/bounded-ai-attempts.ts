import { ProviderError } from './ai-provider';

export const AI_CALLS_PER_ROUND = 2;
const repairable = new Set([
  'AI_INVALID_RESPONSE',
  'AI_INCONSISTENT_EVIDENCE',
  'AI_INVALID_ERROR_SPAN',
  'AI_LOCALE_MISMATCH',
  'AI_TARGET_GRAMMAR_MISSING',
]);
/** A repair spends the existing fallback slot; it never expands the call budget.
 * Each operation must persist its own network receipt before returning/throwing. */
export async function boundedAiAttempts<P, T>(
  providers: P[],
  operation: (provider: P, attempt: number, feedback?: string) => Promise<T>,
): Promise<{ provider: P; response: T }> {
  if (!providers.length)
    throw new ProviderError(
      'No AI provider available',
      'AI_NOT_CONFIGURED',
      true,
    );
  let providerIndex = 0;
  let feedback: string | undefined;
  for (let attempt = 0; attempt < AI_CALLS_PER_ROUND; attempt++) {
    const provider = providers[providerIndex];
    try {
      return {
        provider,
        response: await operation(provider, attempt, feedback),
      };
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        !error.retryable ||
        attempt + 1 === AI_CALLS_PER_ROUND
      )
        throw error;
      if (repairable.has(error.code)) {
        feedback = error.validationFeedback ?? genericFeedback(error.code);
        continue;
      }
      if (providerIndex + 1 >= providers.length) throw error;
      providerIndex++;
      feedback = undefined;
    }
  }
  throw new Error('Unreachable AI budget state');
}
function genericFeedback(code: string) {
  if (code === 'AI_INCONSISTENT_EVIDENCE')
    return 'The previous result marked the original answer correct but silently changed it. Re-read the exact ORIGINAL characters. Judge its original grammar/connection, list every necessary change, then produce a corrected sentence. Never award correctness to your correction as if it were the original.';
  if (code === 'AI_INVALID_ERROR_SPAN')
    return 'Error spans must be literal original-answer text with unambiguous zero-based offsets. Do not invent or alter the original error text.';
  if (code === 'AI_LOCALE_MISMATCH')
    return 'All learner-facing explanations, correction reasons and translations must match the requested session language, including legacy fields ending Zh. Japanese sentence fields stay Japanese.';
  if (code === 'AI_TARGET_GRAMMAR_MISSING')
    return 'The corrected Japanese sentence must correctly use the requested target grammar while preserving the intended meaning. Re-check its entire connection and sentence.';
  return 'The output failed strict structural validation. Independently re-evaluate the ORIGINAL answer. Scores must be integers within their specified maxima and total_score must exactly equal their sum. Furigana must reproduce the exact corrected/reference sentence characters and annotate only kanji, never kana-only words. Preserve all original target-evidence constraints and required field types.';
}
export function withValidationFeedback(
  prompt: string,
  feedback?: string,
  locale: 'zh' | 'en' = 'zh',
  vocabulary = false,
) {
  if (!feedback) return prompt;
  const language = locale === 'en' ? 'English' : 'Simplified Chinese';
  const checklist = vocabulary
    ? 'The reference must use the supplied target vocabulary in its selected sense. Prompt and first hint conceal Japanese target/reading and ask for a JAPANESE answer. Phrase chunks contain plain Japanese without reading brackets and join to the complete reference. Judge original target evidence independently of corrected text; absent target produces null correctness evidence. No scores.'
    : 'Judge the exact ORIGINAL sentence first. Finalize the five integer component scores within their individual maxima and applicable overall target cap. Emit the five component keys before total_score in the JSON. Then add those five values and write that exact sum as total_score. Award evidence-based partial credit in unaffected dimensions; one local error does not make every dimension zero. Do not set the total to a cap while leaving component values whose sum exceeds it. Never mark a silently changed original as correct. With no supplied scenario, scenario_task_completed is false.';
  return `Your previous response was rejected by server validation. This is the single repair attempt. Return complete fresh JSON by independently grading the ORIGINAL input, not any earlier correction. Never discuss this validation or the JSON field names with the learner.
REQUIRED FEEDBACK LANGUAGE: ${language}. Every explanation, correction reason, encouragement and translation (including legacy fields ending Zh or _zh) must be ${language}; Japanese sentences and readings stay Japanese.
VALIDATION_FEEDBACK: ${feedback}
FINAL CONSISTENCY CHECK: ${checklist} Furigana must preserve every sentence character exactly, annotate every kanji group and never annotate kana-only words. Check all rules, not only the last failed field.

${prompt}`;
}
