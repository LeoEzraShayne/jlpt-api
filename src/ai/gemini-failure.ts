import { ProviderError } from './ai-provider';
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
/** Only machine-readable categories/durations escape the provider envelope. */
export function geminiHttpFailure(status: number, envelope: unknown) {
  const error = object(object(envelope).error);
  const details = Array.isArray(error.details) ? error.details.map(object) : [];
  const violations = details.flatMap((d) =>
    Array.isArray(d.violations) ? d.violations.map(object) : [],
  );
  const quotaIds = violations.map((v) =>
    typeof v.quotaId === 'string' ? v.quotaId : '',
  );
  const daily = quotaIds.some((id) => /PerDay/i.test(id));
  const minute = quotaIds.some((id) => /PerMinute/i.test(id));
  const delay = details.find((d) =>
    String(d['@type']).endsWith('/google.rpc.RetryInfo'),
  )?.retryDelay;
  const seconds =
    typeof delay === 'string' && /^\d+(?:\.\d+)?s$/.test(delay)
      ? Number(delay.slice(0, -1))
      : null;
  const hint =
    status === 429
      ? {
          quota: daily
            ? ('day' as const)
            : minute
              ? ('minute' as const)
              : ('unknown' as const),
          retryAfterMs:
            seconds === null
              ? undefined
              : Math.min(86_400_000, Math.max(60_000, seconds * 1000)),
        }
      : undefined;
  const legacyRetryable =
    status === 429 ||
    status >= 500 ||
    ([400, 403].includes(status) &&
      /(?:user location is not supported|failed_precondition)/i.test(
        (typeof error.message === 'string' ? error.message : '') +
          (typeof error.status === 'string' ? error.status : ''),
      ));
  return new ProviderError(
    'Gemini provider request failed',
    `AI_HTTP_${status}`,
    legacyRetryable,
    status,
    undefined,
    hint,
  );
}
/** Pacific midnight follows project RPD resets, including DST transitions. */
export function nextPacificMidnight(now: Date) {
  const date = (time: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(time);
  const today = date(now.getTime());
  let lo = now.getTime(),
    hi = lo + 27 * 60 * 60 * 1000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (date(mid) === today) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}
export function geminiCooldown(error: ProviderError, now: Date) {
  if (error.providerHint?.quota === 'day') return nextPacificMidnight(now);
  const duration =
    error.status === 429
      ? (error.providerHint?.retryAfterMs ?? 60_000)
      : [401, 403, 404].includes(error.status ?? 0)
        ? 86_400_000
        : ['AI_NETWORK_ERROR', 'AI_TIMEOUT'].includes(error.code) ||
            (error.status ?? 0) >= 500
          ? 60_000
          : 300_000;
  return new Date(now.getTime() + duration);
}
export function geminiCanFallback(error: unknown): error is ProviderError {
  return (
    error instanceof ProviderError &&
    (/^AI_HTTP_(?:400|401|403|404|408|429|5\d\d)$/.test(error.code) ||
      [
        'AI_NETWORK_ERROR',
        'AI_TIMEOUT',
        'AI_INVALID_RESPONSE',
        'AI_INCONSISTENT_EVIDENCE',
        'AI_INVALID_ERROR_SPAN',
        'AI_LOCALE_MISMATCH',
        'AI_TARGET_GRAMMAR_MISSING',
      ].includes(error.code))
  );
}
