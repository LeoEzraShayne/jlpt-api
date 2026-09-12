import { geminiHttpFailure } from './gemini-failure';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import { ProviderError } from './ai-provider';
import { assertResponse, fetchWithTimeout } from './provider-utils';
import {
  normalizeUsage,
  paidCost,
  PRICING_VERSION,
  safeUsage,
  type UsageProvider,
} from './usage-cost';
export interface UsageContext {
  userId?: string;
  taskKind?: string;
  taskKey?: string;
  attempt?: number;
}
export class MeteredAiClient {
  constructor(
    private config: ConfigService,
    private prisma?: PrismaService,
  ) {}
  async request<T>(
    provider: UsageProvider,
    prompt: string,
    purpose: string,
    context: UsageContext,
    validate: (text: string) => T,
    jsonSchema?: unknown,
  ) {
    const model = this.config.get<string>(
      `${provider}_MODEL`,
      provider === 'GEMINI' ? 'gemini-3.5-flash' : 'deepseek-chat',
    );
    const effort = this.config.get<string>('DEEPSEEK_THINKING_EFFORT');
    const thinking =
      ['low', 'high', 'max'].includes(effort ?? '') &&
      (this.config.get<string>('DEEPSEEK_THINKING_SCOPE') !== 'grammar' ||
        purpose === 'GRAMMAR_REVIEW');
    const key = this.config.get<string>(`${provider}_API_KEY`);
    if (!key)
      throw new ProviderError(
        'AI provider is not configured',
        'AI_NOT_CONFIGURED',
        true,
      );
    if (!this.prisma)
      throw new ProviderError(
        'AI usage recorder is unavailable',
        'AI_METERING_UNAVAILABLE',
        false,
      );
    const started = new Date();
    const requestId = randomUUID();
    // No network request until its durable receipt exists. A crashed process
    // leaves AI_IN_FLIGHT + null cost for reconciliation, never disappears.
    try {
      await this.prisma.aiUsageRecord.create({
        data: {
          requestId,
          purpose,
          provider,
          model,
          ...context,
          success: false,
          errorCode: 'AI_IN_FLIGHT',
          latencyMs: 0,
        },
      });
    } catch {
      throw new ProviderError(
        'AI usage recorder is unavailable',
        'AI_METERING_UNAVAILABLE',
        false,
      );
    }
    let rawUsage = {};
    let actualModel = model;
    let result: T | undefined;
    let failure: ProviderError | undefined;
    try {
      const gemini = provider === 'GEMINI';
      const response = await fetchWithTimeout(
        gemini
          ? `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
          : 'https://api.deepseek.com/chat/completions',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(gemini
              ? { 'x-goog-api-key': key }
              : { authorization: `Bearer ${key}` }),
          },
          body: JSON.stringify(
            gemini
              ? {
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: {
                    responseMimeType: 'application/json',
                    ...(jsonSchema ? { responseJsonSchema: jsonSchema } : {}),
                    thinkingConfig: model.startsWith('gemini-2.5')
                      ? { thinkingBudget: 0 }
                      : {
                          thinkingLevel: model.endsWith('flash-lite')
                            ? 'minimal'
                            : 'low',
                        },
                    temperature: 0.2,
                  },
                }
              : {
                  model,
                  messages: [{ role: 'user', content: prompt }],
                  response_format: { type: 'json_object' },
                  ...(thinking
                    ? {
                        thinking: { type: 'enabled' },
                        reasoning_effort: effort,
                        max_tokens: 4096,
                      }
                    : { thinking: { type: 'disabled' }, temperature: 0.2 }),
                },
          ),
        },
      );
      const body = await response.text();
      let envelope: unknown = {};
      try {
        envelope = JSON.parse(body) as unknown;
      } catch {
        /* Still record HTTP failure without exposing its body. */
      }
      rawUsage = safeUsage(provider, envelope);
      if (gemini && !response.ok)
        throw geminiHttpFailure(response.status, envelope);
      assertResponse(response, body);
      // Keep configured pricing identity when Gemini reports a dated version.
      const parsed = envelopeSchema.parse(envelope);
      if (!gemini && parsed.model) actualModel = parsed.model;
      const candidate = gemini ? parsed.candidates?.[0] : parsed.choices?.[0];
      const finish = gemini
        ? candidate?.finishReason
        : candidate?.finish_reason;
      if (finish && finish !== (gemini ? 'STOP' : 'stop'))
        throw new ProviderError(
          'AI output was incomplete',
          'AI_INVALID_RESPONSE',
          true,
        );
      const text: unknown = gemini
        ? candidate?.content?.parts
            ?.filter((p: { thought?: boolean }) => !p.thought)
            .map((p: { text?: string }) => p.text ?? '')
            .join('')
        : candidate?.message?.content;
      if (typeof text !== 'string' || !text.trim())
        throw new ProviderError(
          'AI output was empty',
          'AI_INVALID_RESPONSE',
          true,
        );
      result = validate(text);
    } catch (error) {
      failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              'AI returned invalid structured output',
              'AI_INVALID_RESPONSE',
              true,
            );
    }
    const usage = normalizeUsage(provider, rawUsage);
    const costUsd = paidCost(provider, actualModel, usage, started);
    const latencyMs = Date.now() - started.getTime();
    try {
      await this.prisma.aiUsageRecord.update({
        where: { requestId },
        data: {
          model: actualModel,
          ...usage,
          rawUsage,
          latencyMs,
          costUsd,
          pricingVersion: costUsd === null ? null : PRICING_VERSION,
          success: !failure,
          errorCode: failure?.code ?? null,
        },
      });
    } catch {
      throw new ProviderError(
        'AI usage could not be finalized',
        'AI_METERING_UNAVAILABLE',
        false,
      );
    }
    if (failure) throw failure;
    return {
      result: result as T,
      model: actualModel,
      usage: {
        inputTokens: usage.inputTokens ?? undefined,
        outputTokens: usage.outputTokens ?? undefined,
      },
      latencyMs,
    };
  }
}

const candidateSchema = z.object({
  finishReason: z.string().optional(),
  finish_reason: z.string().optional(),
  content: z
    .object({
      parts: z
        .array(
          z.object({
            text: z.string().optional(),
            thought: z.boolean().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  message: z.object({ content: z.string().nullable().optional() }).optional(),
});
const envelopeSchema = z.object({
  model: z.string().optional(),
  candidates: z.array(candidateSchema).optional(),
  choices: z.array(candidateSchema).optional(),
});
