import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  BILLING_ENVIRONMENT: z.enum(['test', 'live']).default('test'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PRICE_DAY_USD: z.string().optional(),
  STRIPE_PRICE_DAY_JPY: z.string().optional(),
  STRIPE_PRICE_YEAR_USD_LAUNCH: z.string().optional(),
  STRIPE_PRICE_YEAR_USD_STANDARD: z.string().optional(),
  STRIPE_PRICE_YEAR_JPY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  ADMIN_EMAIL: z.string().email().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_CALLBACK_URL: z.string().url(),
  AI_PRIMARY_PROVIDER: z.enum(['GEMINI', 'DEEPSEEK']).default('GEMINI'),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  DEEPSEEK_THINKING_EFFORT: z
    .enum(['disabled', 'low', 'high', 'max'])
    .optional(),
  DEEPSEEK_THINKING_SCOPE: z.enum(['all', 'grammar']).optional(),
  AI_WORKER_ENABLED: z
    .string()
    .default('true')
    .transform((value) => value === 'true'),
  REVIEW_ALGORITHM_MODE: z
    .enum(['legacy', 'shadow', 'adaptive'])
    .default('legacy'),
  REVIEW_ALGORITHM_ROLLOUT_PERCENT: z.coerce
    .number()
    .int()
    .min(0)
    .max(100)
    .default(0),
  API_DOCS_ENABLED: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  return parsed.data;
}
