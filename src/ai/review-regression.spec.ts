import { ConfigService } from '@nestjs/config';
import { AiReviewService } from './ai-review.service';
import { parseReviewJson } from './provider-utils';
import { providerReviewSchema } from './review-schema';
import { buildReviewPrompt } from './prompt';
import { ProviderError } from './ai-provider';

const correct = {
  total_score: 100,
  grammar_score: 30,
  connection_score: 20,
  completeness_score: 20,
  naturalness_score: 20,
  vocabulary_score: 10,
  is_correct: true,
  used_target_grammar: true,
  target_grammar_correct: true,
  result_level: 'CORRECT',
  error_spans: [],
  corrected_sentence: 'いいことにする。',
  corrected_sentence_furigana: 'いいことにする。',
  corrected_sentence_translation_zh: '就当作好事。',
  corrected_sentence_uses_target_grammar: true,
  alternative_sentence: 'あしたにすることにする。',
  alternative_sentence_furigana: 'あしたにすることにする。',
  alternative_sentence_translation_zh: '决定改到明天。',
  alternative_sentence_uses_target_grammar: true,
  explanation_zh: '语法正确。',
  encouragement: '继续练习。',
  content_response: '你作出了一个选择。',
  diversity_advice: '下次表达一个不同的决定。',
  next_practice: '用同一语法说明你为旅行作出的决定。',
  scenario_task_completed: true,
};
const input = {
  grammarTitle: '〜ことにする',
  explanation: '决定',
  sentence: 'いいことにする。',
};
const response = () => ({
  result: providerReviewSchema.parse(correct),
  model: 'fixture',
  usage: {},
  latencyMs: 1,
});

describe('scene review regression', () => {
  it('accepts a simple fully correct sentence at 100 without diversity penalty', () => {
    expect(parseReviewJson(JSON.stringify(correct)).total_score).toBe(100);
    expect(buildReviewPrompt(input)).toContain(
      '简单且准确自然的句子也可以100分',
    );
    expect(buildReviewPrompt(input)).toContain('只评价【用户原句】');
  });
  it.each([
    { content_response: '第一句。第二句。第三句。' },
    { scenario_task_completed: 'true' },
    { next_practice: 'x'.repeat(401) },
  ])(
    'strictly rejects invalid extensions but preserves baseline correction: %o',
    (extension) => {
      expect(
        providerReviewSchema.safeParse({ ...correct, ...extension }).success,
      ).toBe(false);
      const result = parseReviewJson(
        JSON.stringify({ ...correct, ...extension }),
      );
      expect(result.corrected_sentence).toBe(correct.corrected_sentence);
      expect(result.total_score).toBe(100);
      expect(result.scenario_task_completed).toBeUndefined();
      expect(result.content_response).toBeUndefined();
    },
  );
  it('degrades a malformed alternative to the verified correction, never inventing scene proof', () => {
    const result = parseReviewJson(
      JSON.stringify({ ...correct, alternative_sentence_furigana: 7 }),
    );
    expect(result.alternative_sentence).toBe(correct.corrected_sentence);
    expect(result.scenario_task_completed).toBeUndefined();
  });
  it.each([
    { total_score: 79 },
    {
      corrected_sentence: '決めることにする。',
      corrected_sentence_furigana: '決めることにする。',
    },
    { corrected_sentence_uses_target_grammar: false },
    { corrected_sentence_translation_zh: '' },
  ])(
    'never salvages invalid core score/target/reading/translation: %o',
    (change) => {
      expect(() =>
        parseReviewJson(JSON.stringify({ ...correct, ...change })),
      ).toThrow(ProviderError);
    },
  );
  it('uses configured DeepSeek first, falling back to Gemini only for retryable failures', async () => {
    const gemini = { review: jest.fn().mockResolvedValue(response()) };
    const deepseek = {
      review: jest
        .fn()
        .mockResolvedValueOnce(response())
        .mockRejectedValueOnce(new ProviderError('busy', 'AI_HTTP_429', true)),
    };
    const config = { get: () => 'DEEPSEEK' } as unknown as ConfigService;
    const service = new AiReviewService(
      gemini as never,
      deepseek as never,
      config,
    );
    expect((await service.review(input)).provider).toBe('DEEPSEEK');
    expect(gemini.review).not.toHaveBeenCalled();
    expect((await service.review(input)).provider).toBe('GEMINI');
  });
  it('keeps correction if expansion drops target, but rejects an invalid correction', async () => {
    const expanded = response();
    expanded.result.alternative_sentence = 'いいね。';
    const service = new AiReviewService(
      { review: jest.fn().mockResolvedValue(expanded) } as never,
      {} as never,
    );
    const result = await service.review(input);
    expect(result.response.result.alternative_sentence).toBe(
      correct.corrected_sentence,
    );
    expect(result.response.result.scenario_task_completed).toBeUndefined();
    const invalid = response();
    invalid.result.corrected_sentence = 'いいね。';
    const bad = new AiReviewService(
      { review: jest.fn().mockResolvedValue(invalid) } as never,
      { review: jest.fn().mockResolvedValue(invalid) } as never,
    );
    await expect(bad.review(input)).rejects.toMatchObject({
      code: 'AI_TARGET_GRAMMAR_MISSING',
    });
  });
});
