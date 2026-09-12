import {
  geminiHttpFailure,
  geminiCooldown,
  nextPacificMidnight,
} from './gemini-failure';
import { ProviderError } from './ai-provider';
it('uses structured daily quota, not a raw error message, for Pacific reset', () => {
  const daily = geminiHttpFailure(429, {
    error: {
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' },
          ],
        },
      ],
    },
  });
  expect(
    geminiCooldown(daily, new Date('2026-09-13T06:59:00Z')).toISOString(),
  ).toBe('2026-09-13T07:00:00.000Z');
  const unknown = geminiHttpFailure(429, {
    error: { message: 'daily quota exceeded secret-key' },
  });
  expect(unknown.providerHint?.quota).toBe('unknown');
  expect(
    geminiCooldown(unknown, new Date('2026-09-13T06:59:00Z')).toISOString(),
  ).toBe('2026-09-13T07:00:00.000Z');
  expect(JSON.stringify(unknown)).not.toContain('secret-key');
});
it('honors structured minute RetryInfo and bounds hostile delay', () => {
  const error = geminiHttpFailure(429, {
    error: {
      details: [
        {
          violations: [
            { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' },
          ],
        },
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '121.5s',
        },
      ],
    },
  });
  expect(error.providerHint).toEqual({ quota: 'minute', retryAfterMs: 121500 });
  expect(geminiCooldown(error, new Date(0)).getTime()).toBe(121500);
});
it('computes DST reset days of 23 and 25 hours, not a fixed UTC offset', () => {
  expect(
    nextPacificMidnight(new Date('2026-03-08T08:00:00Z')).toISOString(),
  ).toBe('2026-03-09T07:00:00.000Z');
  expect(
    nextPacificMidnight(new Date('2026-11-01T07:00:00Z')).toISOString(),
  ).toBe('2026-11-02T08:00:00.000Z');
});
it('separates unavailable, quality and transient cooldowns', () => {
  expect(
    geminiCooldown(geminiHttpFailure(404, {}), new Date(0)).getTime(),
  ).toBe(86400000);
  expect(
    geminiCooldown(
      new ProviderError('invalid', 'AI_INVALID_RESPONSE', true),
      new Date(0),
    ).getTime(),
  ).toBe(300000);
  expect(
    geminiCooldown(
      new ProviderError('network', 'AI_NETWORK_ERROR', true),
      new Date(0),
    ).getTime(),
  ).toBe(60000);
});
