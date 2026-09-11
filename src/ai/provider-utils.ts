import { ProviderError } from './ai-provider';
import {
  providerReviewSchema,
  coreReviewSchema,
  type ProviderReview,
} from './review-schema';

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    // Keep the deadline active while reading the body, not only the headers.
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(body),
    };
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === 'AbortError')
    )
      throw new ProviderError('AI request timed out', 'AI_TIMEOUT', true);
    throw new ProviderError(
      'AI network request failed',
      'AI_NETWORK_ERROR',
      true,
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseReviewJson(
  text: string,
  coreOnly = false,
): ProviderReview {
  try {
    const normalized = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    const parsed = JSON.parse(normalized) as Record<string, unknown>;
    for (const field of ['corrected_sentence', 'alternative_sentence']) {
      if (typeof parsed[field] === 'string')
        parsed[field] = parsed[field].replace(/\[[^\]]+\]/g, '');
    }
    if (coreOnly) return coreReviewSchema.parse(parsed);
    const full = providerReviewSchema.safeParse(parsed);
    if (full.success) return full.data;
    // A malformed supplement must not discard a valid original correction.
    const baseline = { ...parsed };
    for (const key of [
      'content_response',
      'diversity_advice',
      'next_practice',
      'scenario_task_completed',
    ])
      delete baseline[key];
    const withoutExtras = providerReviewSchema.safeParse(baseline);
    if (withoutExtras.success) return withoutExtras.data;
    return providerReviewSchema.parse({
      ...baseline,
      alternative_sentence: baseline.corrected_sentence,
      alternative_sentence_furigana: baseline.corrected_sentence_furigana,
      alternative_sentence_translation_zh:
        baseline.corrected_sentence_translation_zh,
      alternative_sentence_uses_target_grammar:
        baseline.corrected_sentence_uses_target_grammar,
    });
  } catch {
    throw new ProviderError(
      'AI returned invalid structured output',
      'AI_INVALID_RESPONSE',
      true,
    );
  }
}

export function assertResponse(
  response: Pick<Response, 'ok' | 'status'>,
  body: string,
) {
  if (response.ok) return;
  const providerUnavailable =
    [400, 403].includes(response.status) &&
    /(?:user location is not supported|failed_precondition)/i.test(body);
  const retryable =
    providerUnavailable || response.status === 429 || response.status >= 500;
  throw new ProviderError(
    `AI provider returned HTTP ${response.status}: ${body.slice(0, 200)}`,
    `AI_HTTP_${response.status}`,
    retryable,
    response.status,
  );
}
