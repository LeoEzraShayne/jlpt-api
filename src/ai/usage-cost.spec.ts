import { normalizeUsage, paidCost, safeUsage } from './usage-cost';

describe('complete paid AI usage semantics', () => {
  it('counts Gemini thoughts once, includes cached input within prompt total', () => {
    const u = normalizeUsage('GEMINI', {
      promptTokenCount: 1000,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 200,
      totalTokenCount: 1300,
      cachedContentTokenCount: 400,
    });
    expect(u.usageComplete).toBe(true);
    expect(paidCost('GEMINI', 'gemini-3.5-flash', u)).toBeCloseTo(0.00366, 10);
    expect(u.cacheWriteTokens).toBeNull();
  });
  it('DeepSeek completion includes reasoning, never double adds it', () => {
    const u = normalizeUsage('DEEPSEEK', {
      prompt_tokens: 1000,
      completion_tokens: 300,
      total_tokens: 1300,
      prompt_cache_hit_tokens: 400,
      completion_tokens_details: { reasoning_tokens: 200 },
    });
    expect(
      paidCost(
        'DEEPSEEK',
        'deepseek-flash',
        u,
        new Date('2026-09-14T02:00:00Z'),
      ),
    ).toBeCloseTo(0.0005424, 10);
    expect(
      paidCost(
        'DEEPSEEK',
        'deepseek-flash',
        u,
        new Date('2026-09-13T02:00:00Z'),
      ),
    ).toBeCloseTo(0.0002712, 10);
  });
  it('keeps absent counters null; reconciled totals prove billed coverage', () => {
    const u = normalizeUsage('GEMINI', {
      promptTokenCount: 100,
      candidatesTokenCount: 10,
      totalTokenCount: 110,
    });
    expect(u.thinkingTokens).toBeNull();
    expect(u.cachedInputTokens).toBeNull();
    expect(u.usageComplete).toBe(true);
    expect(paidCost('GEMINI', 'gemini-2.5-flash-lite', u)).toBeCloseTo(
      0.000014,
      10,
    );
  });
  it('does not fabricate cost for lost/partial usage, inconsistent totals or unknown model', () => {
    const missing = normalizeUsage('DEEPSEEK', {});
    expect(missing.inputTokens).toBeNull();
    expect(missing.usageComplete).toBe(false);
    expect(paidCost('DEEPSEEK', 'deepseek-flash', missing)).toBeNull();
    const bad = normalizeUsage('GEMINI', {
      promptTokenCount: 100,
      candidatesTokenCount: 10,
      totalTokenCount: 140,
    });
    expect(bad.usageComplete).toBe(false);
    expect(paidCost('GEMINI', 'gemini-2.5-flash-lite', bad)).toBeNull();
    expect(
      paidCost(
        'DEEPSEEK',
        'deepseek-chat',
        normalizeUsage('DEEPSEEK', {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        }),
      ),
    ).toBeNull();
  });
  it('keeps only numeric usage fields, never content/error/key echoes', () => {
    expect(
      safeUsage('DEEPSEEK', {
        usage: {
          prompt_tokens: 2,
          secret: 'sensitive',
          completion_tokens_details: {
            reasoning_tokens: 3,
            content: 'private',
          },
        },
        error: 'secret',
        choices: [],
      }),
    ).toEqual({
      prompt_tokens: 2,
      completion_tokens_details: { reasoning_tokens: 3 },
    });
  });
});
