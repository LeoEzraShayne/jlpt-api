/** Synthetic latency comparison; explicit --run required, never reads learning records. */
import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service';
let metering: PrismaService | undefined;
import { ConfigService } from '@nestjs/config';
import { AiReviewService } from '../src/ai/ai-review.service';
import { GeminiReviewProvider } from '../src/ai/gemini.provider';
import { DeepSeekReviewProvider } from '../src/ai/deepseek.provider';
import type { ReviewProviderInput } from '../src/ai/ai-provider';

async function main() {
  if (!process.argv.includes('--run'))
    throw new Error('Pass --run for three live API requests');
  const config = new ConfigService(process.env);
  metering = new PrismaService(config);
  const service = new AiReviewService(
    new GeminiReviewProvider(config, metering),
    new DeepSeekReviewProvider(config, metering),
    config,
  );
  const input: ReviewProviderInput = {
    grammarLevel: 'N1',
    grammarTitle: '〜かたがた',
    explanation: '兼做另一件事，常用于正式拜访、问候或报告。名词＋かたがた。',
    sentence: 'ご挨拶かたがた、近況をご報告に伺いました。',
  };
  for (const stage of ['CORE', undefined] as const) {
    const started = Date.now();
    const result = await service.review({ ...input, stage });
    console.log(
      JSON.stringify({
        stage: stage ?? 'LEGACY_FULL',
        provider: result.provider,
        seconds: (Date.now() - started) / 1000,
        tokens: result.response.usage,
        result: result.response.result,
      }),
    );
  }
  const incorrect = await service.review({
    stage: 'CORE',
    grammarLevel: 'N4',
    grammarTitle: '〜ながら',
    explanation: '同一主体同时进行两个动作，动词ます形词干＋ながら。',
    sentence: '彼は音楽を聞きながら、私は勉強します。',
  });
  console.log(
    JSON.stringify({
      case: 'different-subjects',
      provider: incorrect.provider,
      result: incorrect.response.result,
    }),
  );
  if (
    incorrect.response.result.target_grammar_correct ||
    incorrect.response.result.total_score > 59 ||
    !incorrect.response.result.error_spans.length ||
    incorrect.response.result.error_spans.some(
      (span) => !span.text || !span.replacement || !span.reason,
    )
  )
    throw new Error('Incorrect target grammar passed the live regression');
}
void main()
  .finally(() => metering?.$disconnect())
  .catch((error) => {
    console.error(error instanceof Error ? error.message : 'Smoke test failed');
    process.exitCode = 1;
  });
