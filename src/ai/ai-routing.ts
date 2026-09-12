import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import { ProviderError } from './ai-provider';
import { boundedAiAttempts } from './bounded-ai-attempts';
import { geminiCanFallback } from './gemini-failure';
import {
  geminiCircuitKey,
  PrismaGeminiCircuit,
  type GeminiCircuit,
} from './gemini-free-circuit';
export interface NamedProvider {
  name: 'GEMINI' | 'DEEPSEEK';
}
export function freeFirstEnabled(config?: ConfigService) {
  const enabled = config?.get<boolean | string>('GEMINI_FREE_FIRST');
  return enabled === true || enabled === 'true';
}
/** Gemini spends only slot one. DeepSeek retains its qualified policy and all
 * remaining slots; a cooling/busy free provider does not consume a network slot. */
export async function routeAi<P extends NamedProvider, T>(
  providers: P[],
  operation: (provider: P, index: number, feedback?: string) => Promise<T>,
  config?: ConfigService,
  prisma?: PrismaService,
  circuit?: GeminiCircuit,
): Promise<{ provider: P; response: T }> {
  if (!freeFirstEnabled(config)) return boundedAiAttempts(providers, operation);
  const deepseek = providers.find((p) => p.name === 'DEEPSEEK');
  if (!deepseek)
    throw new ProviderError(
      'Qualified fallback is not configured',
      'AI_NOT_CONFIGURED',
      false,
    );
  const gemini = providers.find((p) => p.name === 'GEMINI');
  const key = config?.get<string>('GEMINI_API_KEY');
  const gate =
    circuit ?? (prisma ? new PrismaGeminiCircuit(prisma) : undefined);
  const lease =
    gemini && key && gate
      ? await gate.acquire(
          geminiCircuitKey(
            key,
            config!.get<string>('GEMINI_MODEL', 'gemini-3.5-flash'),
          ),
        )
      : null;
  if (!gemini || !lease || !gate)
    return boundedAiAttempts([deepseek], operation);
  try {
    const response = await operation(gemini, 0);
    await gate.release(lease);
    return { provider: gemini, response };
  } catch (error) {
    await gate.release(
      lease,
      error instanceof ProviderError ? error : undefined,
    );
    if (!geminiCanFallback(error)) throw error;
  }
  return { provider: deepseek, response: await operation(deepseek, 1) };
}
