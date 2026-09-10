import { publicAiReviewErrorMessage } from './public-error';

describe('publicAiReviewErrorMessage', () => {
  it('does not expose provider details', () => {
    expect(publicAiReviewErrorMessage('AI_HTTP_400')).toBe(
      'AI 批改服务暂时不可用，请稍后重新批改。',
    );
  });

  it('uses a specific message for timeouts', () => {
    expect(publicAiReviewErrorMessage('AI_TIMEOUT')).toBe(
      'AI 批改响应超时，请稍后重新批改。',
    );
  });
});
