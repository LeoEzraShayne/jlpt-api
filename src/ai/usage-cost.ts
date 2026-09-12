/** Text-only standard paid pricing, verified 2026-09-13. Never assumes free quota. */
export const PRICING_VERSION = '2026-09-13-standard-text-v1';
export type UsageProvider = 'GEMINI' | 'DEEPSEEK';
export interface FullUsage {
  inputTokens: number | null;
  outputTokens: number | null; // Gemini visible candidates; DeepSeek includes reasoning.
  thinkingTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteTokens: number | null;
  totalTokens: number | null;
  usageComplete: boolean;
}
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
const count = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function normalizeUsage(
  provider: UsageProvider,
  raw: unknown,
): FullUsage {
  const u = record(raw);
  const gemini = provider === 'GEMINI';
  const inputTokens = count(gemini ? u.promptTokenCount : u.prompt_tokens);
  const outputTokens = count(
    gemini ? u.candidatesTokenCount : u.completion_tokens,
  );
  const thinkingTokens = count(
    gemini
      ? u.thoughtsTokenCount
      : record(u.completion_tokens_details).reasoning_tokens,
  );
  const totalTokens = count(gemini ? u.totalTokenCount : u.total_tokens);
  const cachedInputTokens = count(
    gemini ? u.cachedContentTokenCount : u.prompt_cache_hit_tokens,
  );
  const cacheWriteTokens = count(
    gemini ? u.cacheWriteTokenCount : u.cache_creation_input_tokens,
  );
  // Missing breakdowns stay null. A reconciled total proves all billed output,
  // even where the provider omits a zero-valued thinking counter.
  const usageComplete =
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens !== null &&
    (gemini
      ? thinkingTokens === null
        ? totalTokens === inputTokens + outputTokens
        : totalTokens === inputTokens + outputTokens + thinkingTokens
      : totalTokens === inputTokens + outputTokens) &&
    (cachedInputTokens === null || cachedInputTokens <= inputTokens) &&
    (gemini || thinkingTokens === null || thinkingTokens <= outputTokens);
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    cachedInputTokens,
    cacheWriteTokens,
    totalTokens,
    usageComplete,
  };
}
export function paidCost(
  provider: UsageProvider,
  model: string,
  u: FullUsage,
  at = new Date(),
  peakOverride?: boolean,
) {
  if (
    !u.usageComplete ||
    (u.cacheWriteTokens !== null && u.cacheWriteTokens > 0) ||
    u.inputTokens === null ||
    u.outputTokens === null ||
    u.totalTokens === null
  )
    return null;
  // All application requests disable explicit cache creation/tools. Missing cache
  // hits use full input price, a conservative estimate, not a fabricated zero.
  const cached = u.cachedInputTokens ?? 0;
  let rates: [number, number, number];
  if (provider === 'DEEPSEEK' && model === 'deepseek-flash') {
    const weekday = at.getUTCDay() >= 1 && at.getUTCDay() <= 5;
    const h = at.getUTCHours();
    const peak =
      peakOverride ?? (weekday && ((h >= 1 && h < 4) || (h >= 6 && h < 10)));
    rates = peak ? [0.3, 0.006, 1.2] : [0.15, 0.003, 0.6];
  } else if (provider === 'GEMINI' && model === 'gemini-3.5-flash')
    rates = [1.5, 0.15, 9];
  else if (provider === 'GEMINI' && model === 'gemini-2.5-flash-lite')
    rates = [0.1, 0.01, 0.4];
  else if (provider === 'GEMINI' && model === 'gemini-3.1-flash-lite')
    rates = [0.25, 0.025, 1.5];
  else if (provider === 'GEMINI' && model === 'gemini-3.5-flash-lite')
    rates = [0.3, 0.03, 2.5];
  else return null; // Unknown/legacy aliases require verified pricing, never guess.
  const billedOutput =
    provider === 'GEMINI' ? u.totalTokens - u.inputTokens : u.outputTokens;
  return (
    ((u.inputTokens - cached) * rates[0] +
      cached * rates[1] +
      billedOutput * rates[2]) /
    1_000_000
  );
}
export function safeUsage(provider: UsageProvider, envelope: unknown) {
  const root = record(envelope);
  const raw = record(provider === 'GEMINI' ? root.usageMetadata : root.usage);
  const allowed =
    provider === 'GEMINI'
      ? [
          'promptTokenCount',
          'candidatesTokenCount',
          'thoughtsTokenCount',
          'cachedContentTokenCount',
          'cacheWriteTokenCount',
          'totalTokenCount',
        ]
      : [
          'prompt_tokens',
          'completion_tokens',
          'total_tokens',
          'prompt_cache_hit_tokens',
          'prompt_cache_miss_tokens',
          'cache_creation_input_tokens',
        ];
  const result: Record<string, number | Record<string, number>> = {};
  for (const key of allowed) {
    const value = count(raw[key]);
    if (value !== null) result[key] = value;
  }
  const reasoning = count(
    record(raw.completion_tokens_details).reasoning_tokens,
  );
  if (provider === 'DEEPSEEK' && reasoning !== null)
    result.completion_tokens_details = { reasoning_tokens: reasoning };
  return result;
}
