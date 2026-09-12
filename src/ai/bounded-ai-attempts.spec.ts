import { boundedAiAttempts } from './bounded-ai-attempts';
import { ProviderError } from './ai-provider';
import { parseReviewJson } from './provider-utils';
import { ConfigService } from '@nestjs/config';
import { AiReviewService } from './ai-review.service';
it('spends the fallback slot on exactly one repair with safe validation feedback', async () => {
  const operation = jest
    .fn()
    .mockRejectedValueOnce(
      new ProviderError(
        'invalid',
        'AI_INVALID_RESPONSE',
        true,
        undefined,
        'Exact sum required.',
      ),
    )
    .mockResolvedValueOnce('valid');
  await expect(
    boundedAiAttempts(['PRIMARY', 'FALLBACK'], operation),
  ).resolves.toEqual({ provider: 'PRIMARY', response: 'valid' });
  expect(operation.mock.calls).toEqual([
    ['PRIMARY', 0, undefined],
    ['PRIMARY', 1, 'Exact sum required.'],
  ]);
});
it('never adds a third call after repair fails', async () => {
  const error = new ProviderError(
    'inconsistent',
    'AI_INCONSISTENT_EVIDENCE',
    true,
  );
  const operation = jest.fn().mockRejectedValue(error);
  await expect(
    boundedAiAttempts(['PRIMARY', 'FALLBACK'], operation),
  ).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(2);
});
it('falls back for availability, but does not add repair after that fallback', async () => {
  const error = new ProviderError('invalid', 'AI_INVALID_RESPONSE', true);
  const operation = jest
    .fn()
    .mockRejectedValueOnce(
      new ProviderError('rate limited', 'AI_HTTP_429', true),
    )
    .mockRejectedValueOnce(error);
  await expect(
    boundedAiAttempts(['PRIMARY', 'FALLBACK'], operation),
  ).rejects.toBe(error);
  expect(operation.mock.calls).toEqual([
    ['PRIMARY', 0, undefined],
    ['FALLBACK', 1, undefined],
  ]);
});
it('retains actual provider error when no fallback exists and never repairs metering failure', async () => {
  for (const error of [
    new ProviderError('timeout', 'AI_TIMEOUT', true),
    new ProviderError('metering', 'AI_METERING_UNAVAILABLE', false),
  ]) {
    const operation = jest.fn().mockRejectedValue(error);
    await expect(boundedAiAttempts(['ONLY'], operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  }
});
it('omits unconfigured grammar providers so a missing key cannot replace the original error', async () => {
  const error = new ProviderError('timeout', 'AI_TIMEOUT', true);
  const primary = { review: jest.fn().mockRejectedValue(error) };
  const missing = { review: jest.fn() };
  const service = new AiReviewService(
    missing as never,
    primary as never,
    new ConfigService({
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: 'mock',
      AI_PRIMARY_PROVIDER: 'GEMINI',
    }),
  );
  await expect(
    service.review({
      grammarTitle: '～たい',
      explanation: 'want to',
      sentence: '行きたい。',
    }),
  ).rejects.toBe(error);
  expect(missing.review).not.toHaveBeenCalled();
  expect(primary.review).toHaveBeenCalledTimes(1);
});
it('keeps strict score validation and returns a fixed repair hint without echoed output', () => {
  const invalid = {
    total_score: 30,
    grammar_score: 10,
    connection_score: 5,
    completeness_score: 10,
    naturalness_score: 5,
    vocabulary_score: 5,
    is_correct: false,
    used_target_grammar: true,
    target_grammar_correct: false,
    result_level: 'INCORRECT',
    error_spans: [],
    corrected_sentence: '書きやすい。',
    corrected_sentence_furigana: '書[か]きやすい。',
    corrected_sentence_translation_zh: 'Easy to write.',
    corrected_sentence_uses_target_grammar: true,
    explanation_zh: 'private attacker text',
    encouragement: 'Keep practicing.',
  };
  try {
    parseReviewJson(JSON.stringify(invalid), true);
    throw Error('must reject');
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    const hint = (error as ProviderError).validationFeedback;
    expect(hint).toContain('EXACT sum');
    expect(hint).not.toContain('attacker');
  }
});
