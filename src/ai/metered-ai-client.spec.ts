/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed any; all persisted values are asserted. */
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import { MeteredAiClient } from './metered-ai-client';
import { ProviderError } from './ai-provider';
import { fetchWithTimeout } from './provider-utils';
jest.mock('./provider-utils', () => ({
  ...jest.requireActual<typeof import('./provider-utils')>('./provider-utils'),
  fetchWithTimeout: jest.fn(),
}));
const network = jest.mocked(fetchWithTimeout);
function fixture() {
  const db = {
    aiUsageRecord: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const client = new MeteredAiClient(
    new ConfigService({
      DEEPSEEK_API_KEY: 'mock-secret',
      DEEPSEEK_MODEL: 'deepseek-flash',
    }),
    db as unknown as PrismaService,
  );
  return { db, client };
}
function response(status = 200) {
  return {
    ok: status === 200,
    status,
    text: () =>
      Promise.resolve(
        JSON.stringify({
          model: 'deepseek-flash',
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            total_tokens: 120,
            prompt_cache_hit_tokens: 0,
          },
          choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
          error: { message: 'must never leak mock-secret' },
        }),
      ),
  };
}
beforeEach(() => network.mockReset());
describe('durable per-network receipts', () => {
  it('awaits durable admission before network and stores complete paid usage', async () => {
    const { client, db } = fixture();
    let released!: () => void;
    db.aiUsageRecord.create.mockReturnValueOnce(
      new Promise<void>((resolve) => (released = resolve)),
    );
    network.mockResolvedValueOnce(response());
    const call = client.request(
      'DEEPSEEK',
      'private prompt',
      'TEST',
      { taskKind: 'GRAMMAR', taskKey: 'task', attempt: 2 },
      () => ({ ok: true }),
    );
    expect(network).not.toHaveBeenCalled();
    released();
    await call;
    expect(db.aiUsageRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          errorCode: 'AI_IN_FLIGHT',
          attempt: 2,
        }),
      }),
    );
    expect(db.aiUsageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: true,
          usageComplete: true,
          inputTokens: 100,
          thinkingTokens: null,
        }),
      }),
    );
    expect(JSON.stringify(db.aiUsageRecord.update.mock.calls)).not.toContain(
      'private',
    );
    expect(JSON.parse(network.mock.calls[0][1].body as string)).toHaveProperty(
      'thinking.type',
      'disabled',
    );
  });
  it('fails closed when admission persistence fails', async () => {
    const { client, db } = fixture();
    db.aiUsageRecord.create.mockRejectedValueOnce(Error('DB'));
    await expect(
      client.request('DEEPSEEK', 'p', 'TEST', {}, () => true),
    ).rejects.toMatchObject({
      code: 'AI_METERING_UNAVAILABLE',
      retryable: false,
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('records charged invalid output before allowing a retry', async () => {
    const { client, db } = fixture();
    network.mockResolvedValueOnce(response());
    await expect(
      client.request('DEEPSEEK', 'p', 'TEST', {}, () => {
        throw Error('bad schema');
      }),
    ).rejects.toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(db.aiUsageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          errorCode: 'AI_INVALID_RESPONSE',
          usageComplete: true,
          costUsd: expect.any(Number),
        }),
      }),
    );
  });
  it('records failed HTTP usage without leaking the provider error body', async () => {
    const { client, db } = fixture();
    network.mockResolvedValueOnce(response(500));
    await expect(
      client.request('DEEPSEEK', 'p', 'TEST', {}, () => true),
    ).rejects.toMatchObject({
      code: 'AI_HTTP_500',
      message: 'AI provider returned HTTP 500',
    });
    expect(db.aiUsageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ success: false, outputTokens: 20 }),
      }),
    );
  });
  it('retains unknown cost for timeouts and stops fallback if finalization fails', async () => {
    const { client, db } = fixture();
    network.mockRejectedValueOnce(
      new ProviderError('timeout', 'AI_TIMEOUT', true),
    );
    await expect(
      client.request('DEEPSEEK', 'p', 'TEST', {}, () => true),
    ).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(db.aiUsageRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          success: false,
          inputTokens: null,
          costUsd: null,
          usageComplete: false,
        }),
      }),
    );
    network.mockResolvedValueOnce(response());
    db.aiUsageRecord.update.mockRejectedValueOnce(Error('DB'));
    await expect(
      client.request('DEEPSEEK', 'p', 'TEST', {}, () => true),
    ).rejects.toMatchObject({
      code: 'AI_METERING_UNAVAILABLE',
      retryable: false,
    });
  });
});
