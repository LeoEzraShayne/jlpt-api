import { ProviderError } from './ai-provider';
import { providerReviewSchema, type ProviderReview } from './review-schema';

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
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

export function parseReviewJson(text: string): ProviderReview {
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
    return providerReviewSchema.parse(parsed);
  } catch {
    throw new ProviderError(
      'AI returned invalid structured output',
      'AI_INVALID_RESPONSE',
      true,
    );
  }
}

export function assertResponse(response: Response, body: string) {
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
