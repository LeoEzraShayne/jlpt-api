import { AiReviewService } from '../../src/ai/ai-review.service';
import { fileReceipts } from './file-receipts';
/** Explicit synthetic paid regression; guard disposable local DB. No real user data. */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { GeminiReviewProvider } from '../../src/ai/gemini.provider';
import { DeepSeekReviewProvider } from '../../src/ai/deepseek.provider';
import { VocabularyAiService } from '../../src/vocabulary-learning/vocabulary-ai.service';
import { ProviderError } from '../../src/ai/ai-provider';
import type {
  AiVocabularyInput,
  Challenge,
} from '../../src/vocabulary-learning/vocabulary-ai.schema';
import { paidCost, type FullUsage } from '../../src/ai/usage-cost';

const receiptPath = process.argv
  .find((a) => a.startsWith('--receipt-file='))
  ?.slice('--receipt-file='.length);
const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
if (
  !receiptPath &&
  (!['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/jlpt_sentence_lab_ai_20260913')
)
  throw new Error('Only isolated AI evaluation database is permitted');
if (!process.argv.includes('--run'))
  throw new Error('Pass --run for authorized paid synthetic requests');
const db = receiptPath
  ? fileReceipts(receiptPath)
  : new PrismaService(new ConfigService(process.env));
const selectedModel = process.argv
  .find((a) => a.startsWith('--model='))
  ?.slice(8);
const selectedCases = process.argv
  .find((a) => a.startsWith('--cases='))
  ?.slice(8)
  .split(',');
const tag =
  process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'current';
if (!/^[a-z0-9-]+$/.test(tag)) throw Error('Invalid output tag');
const models = selectedModel
  ? [selectedModel]
  : process.argv.includes('--gemini')
    ? ['gemini-2.5-flash-lite', 'gemini-3.5-flash']
    : process.argv.includes('--legacy')
      ? ['deepseek-chat']
      : process.argv.includes('--lite')
        ? ['gemini-2.5-flash-lite']
        : ['deepseek-flash', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'];
const rows: unknown[] = [];
const syntheticRaw: unknown[] = [];
const originalFetch = global.fetch;
global.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.ok) {
    const envelope = (await response.clone().json()) as {
      model?: string;
      candidates?: unknown;
      choices?: unknown;
      usage?: unknown;
      usageMetadata?: unknown;
    };
    syntheticRaw.push({
      model:
        envelope.model ??
        String(args[0]).match(/models\/(.+):generateContent/)?.[1],
      candidates: sanitizeCandidates(envelope.candidates),
      choices: sanitizeChoices(envelope.choices),
      usage: envelope.usage,
      usageMetadata: envelope.usageMetadata,
    });
    writeFileSync(
      `scripts/ai-cost/synthetic-raw-${tag}.json`,
      JSON.stringify(syntheticRaw, null, 2),
      { mode: 0o600 },
    );
  }
  return response;
};
const runId = new Date().toISOString();
const grammarCases = [
  {
    id: 'n5-correct',
    title: '～たい',
    meaning: '想要做某事',
    connection: '动词ます形去ます＋たい',
    sentence: '日本で働きたいです。',
    target: true,
    correct: true,
    min: 90,
  },
  {
    id: 'n5-connection',
    title: '～たい',
    meaning: '想要做某事',
    connection: '动词ます形去ます＋たい',
    sentence: '日本で働くたいです。',
    target: true,
    correct: false,
    max: 59,
  },
  {
    id: 'n4-correct',
    title: '～ながら',
    meaning: '同一主体同时进行两个动作',
    connection: '动词ます形去ます＋ながら',
    sentence: '音楽を聞きながら料理をします。',
    target: true,
    correct: true,
    min: 90,
  },
  {
    id: 'n4-connection',
    title: '～ながら',
    meaning: '同一主体同时进行两个动作',
    connection: '动词ます形去ます＋ながら',
    sentence: '音楽を聞くながら料理をします。',
    target: true,
    correct: false,
    max: 59,
  },
  {
    id: 'n1-correct',
    title: '～に至るまで',
    meaning: '范围涉及细节，甚至到',
    connection: '名词＋に至るまで',
    sentence: '彼は料理の材料から盛り付けに至るまで気を配っている。',
    target: true,
    correct: true,
    min: 85,
  },
  {
    id: 'missing-target',
    title: '～ながら',
    meaning: '同一主体同时进行两个动作',
    connection: '动词ます形去ます＋ながら',
    sentence: '毎日、日本語を勉強しています。',
    target: false,
    correct: false,
    max: 30,
  },
];
const words = [
  {
    id: 'report',
    word: '報告',
    reading: 'ほうこく',
    gloss: '汇报、报告',
    english: 'report; reporting',
    sentence: '会議で調査の結果を報告しました。',
    furigana:
      '会議[かいぎ]で調査[ちょうさ]の結果[けっか]を報告[ほうこく]しました。',
    translation: 'I reported the investigation results at the meeting.',
    zh: '我在会议上汇报了调查结果。',
    correct: '会議で調査の結果を報告しました。',
    wrong: 'おなかがすいたので、報告を食べました。',
    alternate: 'おなかがすいたので、ご飯を食べました。',
  },
  {
    id: 'refuse',
    word: '断る',
    reading: 'ことわる',
    gloss: '拒绝请求',
    english: 'refuse a request',
    sentence: '予定があるので、友達の誘いを断りました。',
    furigana:
      '予定[よてい]があるので、友達[ともだち]の誘[さそ]いを断[ことわ]りました。',
    translation: 'I declined my friend’s invitation because I had plans.',
    zh: '因为已有安排，我拒绝了朋友的邀请。',
    correct: '予定があるので、友達の誘いを断りました。',
    wrong: 'おなかがすいたので、パンを断って食べました。',
    alternate: '予定があるので、行けません。',
  },
];
async function run(model: string) {
  const gemini = model.startsWith('gemini');
  const config = new ConfigService({
    ...process.env,
    GEMINI_API_KEY: gemini ? process.env.GEMINI_API_KEY : '',
    DEEPSEEK_API_KEY: gemini ? '' : process.env.DEEPSEEK_API_KEY,
    AI_PRIMARY_PROVIDER: gemini ? 'GEMINI' : 'DEEPSEEK',
    GEMINI_MODEL: model,
    DEEPSEEK_MODEL: model,
  });
  const provider = new AiReviewService(
    new GeminiReviewProvider(config, db),
    new DeepSeekReviewProvider(config, db),
    config,
  );
  const vocab = new VocabularyAiService(config, db);
  let unavailable = false;
  const capture = async (
    id: string,
    locale: 'zh' | 'en',
    op: () => Promise<unknown>,
  ) => {
    if (selectedCases && !selectedCases.includes(id)) return;
    if (unavailable) {
      rows.push({
        model,
        id,
        locale,
        skipped: 'PROVIDER_UNAVAILABLE_AFTER_OBSERVED_ERROR',
      });
      return;
    }
    try {
      const result = await op();
      rows.push({ model, id, locale, result });
      console.log(model, id, locale, 'completed');
    } catch (error) {
      if (
        error instanceof ProviderError &&
        ['AI_HTTP_400', 'AI_HTTP_403', 'AI_HTTP_404', 'AI_HTTP_429'].includes(
          error.code,
        )
      )
        unavailable = true;
      rows.push({
        model,
        id,
        locale,
        error:
          error instanceof ProviderError ? error.code : 'EVALUATION_FAILED',
      });
      console.log(model, id, locale, 'failed');
    }
    writeFileSync(
      `scripts/ai-cost/results-${tag}.json`,
      JSON.stringify({ runId, rows }, null, 2),
    );
  };
  for (const locale of ['zh', 'en'] as const) {
    for (const item of grammarCases)
      await capture(item.id, locale, async () => {
        const { response } = await provider.review({
          stage: 'CORE',
          explanationLocale: locale,
          grammarTitle: item.title,
          explanation: item.meaning,
          connectionRule: item.connection,
          sentence: item.sentence,
          usageContext: {
            taskKind: 'EVALUATION',
            taskKey: `${runId}:${model}:${locale}:${item.id}`,
          },
        });
        const r = response.result;
        return {
          ...response,
          sentence: item.sentence,
          passed:
            r.used_target_grammar === item.target &&
            r.target_grammar_correct === item.correct &&
            (item.min === undefined || r.total_score >= item.min) &&
            (item.max === undefined || r.total_score <= item.max) &&
            (item.correct
              ? r.error_spans.length === 0
              : !item.target || r.error_spans.length > 0),
        };
      });
    for (const word of words) {
      const input: AiVocabularyInput = {
        explanationLocale: locale,
        word: word.word,
        reading: word.reading,
        chineseGloss: word.gloss,
        senseKey: word.id,
        glosses: [{ language: 'eng', text: word.english }],
        grammars: [],
        previousPrompts: [],
      };
      const c: Challenge = {
        promptZh:
          locale === 'en'
            ? 'Tell your colleague what happened yesterday.'
            : '向同事说明昨天发生的事情。',
        meaningHintZh:
          locale === 'en'
            ? 'Use the word in its intended meaning.'
            : '使用本次练习词的指定含义。',
        grammarId: null,
        referenceSentence: word.sentence,
        referenceFurigana: word.furigana,
        referenceTranslationZh: locale === 'en' ? word.translation : word.zh,
        chunks: [word.sentence.slice(0, 3), word.sentence.slice(3)],
      };
      await capture(`${word.id}-generate`, locale, async () => ({
        challenge: await vocab.generate(input, {
          taskKind: 'EVALUATION',
          taskKey: `${runId}:${model}:${locale}:${word.id}-generate`,
        }),
        passed: true,
      }));
      for (const type of ['correct', 'wrong', 'alternate'] as const)
        await capture(`${word.id}-${type}`, locale, async () => {
          const assessment = await vocab.assess(input, c, word[type], {
            taskKind: 'EVALUATION',
            taskKey: `${runId}:${model}:${locale}:${word.id}-${type}`,
          });
          return {
            sentence: word[type],
            assessment,
            passed:
              assessment.usedTarget === (type !== 'alternate') &&
              assessment.targetCorrect ===
                (type === 'alternate' ? null : type === 'correct') &&
              assessment.meaningCorrect ===
                (type === 'alternate' ? null : type === 'correct'),
          };
        });
    }
  }
}
async function main() {
  await Promise.all(models.map(run));
  const usage = await db.aiUsageRecord.findMany({
    where: { taskKind: 'EVALUATION', taskKey: { startsWith: runId } },
    orderBy: { createdAt: 'asc' },
  });
  writeFileSync(
    `scripts/ai-cost/usage-${tag}.json`,
    JSON.stringify(
      usage.map((u) => ({
        ...u,
        costAtPeakUsd: paidCost(
          u.provider as 'GEMINI' | 'DEEPSEEK',
          u.model,
          u as FullUsage,
          u.createdAt,
          true,
        ),
      })),
      null,
      2,
    ),
  );
  writeFileSync(
    `scripts/ai-cost/results-${tag}.json`,
    JSON.stringify({ runId, rows }, null, 2),
    { mode: 0o600 },
  );
  await db.$disconnect();
}
main().catch(() => {
  console.error('Evaluation failed; inspect durable usage records.');
  process.exitCode = 1;
});

function sanitizeCandidates(value: unknown) {
  return Array.isArray(value)
    ? value.map(
        (v: {
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
          finishReason?: string;
        }) => ({
          finishReason: v.finishReason,
          content: {
            parts: v.content?.parts
              ?.filter((p) => !p.thought)
              .map((p) => ({ text: p.text })),
          },
        }),
      )
    : undefined;
}
function sanitizeChoices(value: unknown) {
  return Array.isArray(value)
    ? value.map(
        (v: { finish_reason?: string; message?: { content?: string } }) => ({
          finish_reason: v.finish_reason,
          message: { content: v.message?.content },
        }),
      )
    : undefined;
}
