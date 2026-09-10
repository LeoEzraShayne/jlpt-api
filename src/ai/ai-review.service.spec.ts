import { AiProvider } from '@prisma/client';
import { ProviderError } from './ai-provider';
import { AiReviewService } from './ai-review.service';

const response = {
  result: {
    corrected_sentence: '時代につれて生活も変わります。',
    alternative_sentence: '状況につれて考え方も変化します。',
  } as never,
  model: 'test',
  usage: {},
  latencyMs: 1,
};
const input = {
  grammarTitle: '〜につれて',
  explanation: '随着',
  sentence: '文',
};

describe('AiReviewService', () => {
  it('uses Gemini by default', async () => {
    const gemini = { review: jest.fn().mockResolvedValue(response) };
    const deepseek = { review: jest.fn() };
    const service = new AiReviewService(gemini as never, deepseek as never);
    await expect(service.review(input)).resolves.toMatchObject({
      provider: AiProvider.GEMINI,
    });
    expect(deepseek.review).not.toHaveBeenCalled();
  });

  it('falls back to DeepSeek for retryable provider failures', async () => {
    const gemini = {
      review: jest
        .fn()
        .mockRejectedValue(
          new ProviderError('rate limited', 'AI_HTTP_429', true, 429),
        ),
    };
    const deepseek = { review: jest.fn().mockResolvedValue(response) };
    const service = new AiReviewService(gemini as never, deepseek as never);
    await expect(service.review(input)).resolves.toMatchObject({
      provider: AiProvider.DEEPSEEK,
    });
  });

  it('does not fall back for non-retryable failures', async () => {
    const error = new ProviderError('bad request', 'AI_HTTP_400', false, 400);
    const service = new AiReviewService(
      { review: jest.fn().mockRejectedValue(error) } as never,
      { review: jest.fn() } as never,
    );
    await expect(service.review(input)).rejects.toBe(error);
  });
});
