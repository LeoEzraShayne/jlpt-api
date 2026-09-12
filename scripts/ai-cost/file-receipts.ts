import { appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import type { PrismaService } from '../../src/database/prisma.service';
/** Isolated synthetic evaluator only: fsynced append-only receipts before network.
 * This is never used by the application, which requires its database recorder. */
export function fileReceipts(path: string) {
  if (!path.startsWith('/tmp/jlpt-ai-eval-') || !path.endsWith('.jsonl'))
    throw Error(
      'Receipt file must be in dedicated /tmp/jlpt-ai-eval-* directory',
    );
  const records = new Map<string, Record<string, unknown>>();
  const fd = openSync(path, 'ax', 0o600);
  function save(row: Record<string, unknown>) {
    appendFileSync(fd, JSON.stringify(row) + '\n');
    fsyncSync(fd);
  }
  const db = {
    aiUsageRecord: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          ...data,
          createdAt: new Date(),
          inputTokens: null,
          outputTokens: null,
          thinkingTokens: null,
          cachedInputTokens: null,
          cacheWriteTokens: null,
          totalTokens: null,
          usageComplete: false,
          costUsd: null,
        };
        records.set(String(data.requestId), row);
        save(row);
        return Promise.resolve(row);
      },
      update: ({
        where,
        data,
      }: {
        where: { requestId: string };
        data: Record<string, unknown>;
      }) => {
        const row = { ...records.get(where.requestId), ...data };
        save(row);
        records.set(where.requestId, row);
        return Promise.resolve(row);
      },
      findMany: () => Promise.resolve([...records.values()]),
    },
    $disconnect: () => {
      closeSync(fd);
      return Promise.resolve();
    },
  };
  return db as unknown as PrismaService;
}
