const timeoutCodes = new Set(['AI_TIMEOUT', 'AI_NETWORK_ERROR']);

export function publicAiReviewErrorMessage(code?: string | null) {
  if (code && timeoutCodes.has(code))
    return 'AI 批改响应超时，请稍后重新批改。';
  return 'AI 批改服务暂时不可用，请稍后重新批改。';
}
