/** Small synthetic live regression. No personal learning records or credentials are logged. */
import 'dotenv/config';
import { PrismaService } from '../src/database/prisma.service';
let metering: PrismaService | undefined;
import { ConfigService } from '@nestjs/config';
import { VocabularyAiService } from '../src/vocabulary-learning/vocabulary-ai.service';
import type { AiVocabularyInput } from '../src/vocabulary-learning/vocabulary-ai.schema';

async function main() {
  if (!process.argv.includes('--run'))
    throw new Error('Pass --run for four configured-provider requests');
  const config = new ConfigService(process.env);
  metering = new PrismaService(config);
  const ai = new VocabularyAiService(config, metering);
  const input: AiVocabularyInput = {
    word: '報告',
    reading: 'ほうこく',
    chineseGloss: '报告；汇报',
    senseKey: 'report',
    glosses: [{ language: 'eng', text: 'report; information' }],
    grammars: [
      {
        id: 'synthetic-n4-node',
        title: '〜ので',
        chineseExplanation: '表示原因或理由。',
      },
    ],
    previousPrompts: [],
  };
  let started = Date.now();
  const challenge = await ai.generate(input);
  console.log(
    JSON.stringify({
      stage: 'generate',
      seconds: (Date.now() - started) / 1000,
      prompt: challenge.promptZh,
      reference: challenge.referenceSentence,
      grammarId: challenge.grammarId,
    }),
  );
  for (const item of [
    {
      name: 'target-correct',
      sentence: '調査が終わったので、結果を報告します。',
      used: true,
      correct: true,
    },
    {
      name: 'target-incorrect',
      sentence: 'おなかがすいたので、報告を食べました。',
      used: true,
      correct: false,
    },
    {
      name: 'natural-alternative',
      sentence: '調査が終わったので、結果を伝えます。',
      used: false,
      correct: null,
    },
  ]) {
    started = Date.now();
    const result = await ai.assess(input, challenge, item.sentence);
    const passed =
      result.usedTarget === item.used &&
      result.targetCorrect === item.correct &&
      result.readingCorrect === null;
    console.log(
      JSON.stringify({
        stage: item.name,
        passed,
        seconds: (Date.now() - started) / 1000,
        result,
      }),
    );
    if (!passed) process.exitCode = 1;
  }
}
void main()
  .finally(() => metering?.$disconnect())
  .catch((error: unknown) => {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'SMOKE_FAILED';
    console.error(JSON.stringify({ passed: false, code }));
    process.exitCode = 1;
  });
