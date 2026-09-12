import { createHash, randomUUID } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service';
import { geminiCooldown } from './gemini-failure';
import type { ProviderError } from './ai-provider';
export interface GeminiLease {
  key: string;
  token: string;
}
export interface GeminiCircuit {
  acquire(key: string): Promise<GeminiLease | null>;
  release(lease: GeminiLease, error?: ProviderError): Promise<void>;
}
export function geminiCircuitKey(apiKey: string, model: string) {
  return `gemini-free:${createHash('sha256').update(apiKey).digest('hex')}:${model}`;
}
/** Durable CAS lease: at most one Gemini candidate across grammar/vocabulary
 * and processes. Other operations go directly to DeepSeek, without waiting. */
export class PrismaGeminiCircuit implements GeminiCircuit {
  constructor(private readonly prisma: PrismaService) {}
  async acquire(key: string): Promise<GeminiLease | null> {
    const token = randomUUID();
    try {
      await this.prisma.$executeRaw`
        INSERT INTO "AiProviderCircuit" (key,"updatedAt") VALUES (${key},(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
        ON CONFLICT (key) DO NOTHING`;
      const rows = await this.prisma.$queryRaw<Array<{ key: string }>>`
        UPDATE "AiProviderCircuit" SET "leaseToken"=${token},
          "leaseUntil"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+interval '30 seconds', "updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE key=${key} AND ("blockedUntil" IS NULL OR "blockedUntil"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC'))
          AND ("leaseUntil" IS NULL OR "leaseUntil"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) RETURNING key`;
      return rows.length ? { key, token } : null;
    } catch {
      // Failure to establish the free-provider gate must never admit Gemini.
      return null;
    }
  }
  async release(lease: GeminiLease, error?: ProviderError) {
    const until = error ? geminiCooldown(error, new Date()) : null;
    const reason =
      error?.providerHint?.quota === 'day'
        ? 'DAILY_QUOTA'
        : (error?.code ?? null);
    try {
      await this.prisma.$executeRaw`
        UPDATE "AiProviderCircuit" SET "leaseToken"=NULL,"leaseUntil"=NULL,
          "blockedUntil"=${until},reason=${reason},"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        WHERE key=${lease.key} AND "leaseToken"=${lease.token}`;
    } catch {
      /* The persisted lease expires; never repeat the completed network call. */
    }
  }
}
