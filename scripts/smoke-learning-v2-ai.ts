/** Small, explicit paid-provider smoke test using synthetic sentences only. */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { AiReviewService } from '../src/ai/ai-review.service';
import { GeminiReviewProvider } from '../src/ai/gemini.provider';
import { DeepSeekReviewProvider } from '../src/ai/deepseek.provider';
import type { ReviewProviderInput } from '../src/ai/ai-provider';
import type { TrainingContext } from '../src/scenes/training-context';

const context: TrainingContext = {
  version: 'training-v1',
  instructionZh: '完成新的表达目的，不只换名词。',
  scenario: {
    version: 'scenario-v1',
    id: 'life-propose-plan',
    scenarioId: 'life-propose-plan',
    taskId: 'scenario-v1:life-propose-plan:PROPOSE_PLAN',
    objectiveId: 'PROPOSE_PLAN',
    domain: 'LIFE',
    objective: 'PROPOSE_PLAN',
    register: 'CASUAL',
    promptZh: '向朋友提出一个周末安排，并说明为什么适合你们。',
  },
  words: [
    {
      id: 'synthetic-reservation',
      word: '予約',
      reading: 'よやく',
      chineseGloss: '预约',
      glosses: [{ language: 'eng', text: 'reservation' }],
      sourceName: 'Synthetic smoke fixture',
      sourceVersion: 'v1',
    },
  ],
  supportingGrammar: { id: 'synthetic-node', title: '～ので', level: 'N4' },
  expressions: [],
  phrases: [],
};
const base: Omit<ReviewProviderInput, 'sentence'> = {
  grammarLevel: 'N1',
  grammarTitle: '～に至るまで',
  explanation: '表示范围涉及细节，甚至到……。',
  connectionRule: '名词＋に至るまで',
  trainingMode: 'TRANSFER',
  trainingContext: context,
};
const cases: Array<{
  name: string;
  input: ReviewProviderInput;
  target: boolean;
  scenario: boolean;
  minimum?: number;
  maximum?: number;
}> = [
  {
    name: 'new-communication-objective',
    target: true,
    scenario: true,
    minimum: 80,
    input: {
      ...base,
      sentence:
        '今度の週末は、店の内装から料理の盛り付けに至るまでこだわったレストランに行こう。二人とも料理が好きだから、きっと楽しめるよ。',
    },
  },
  {
    name: 'correct-grammar-wrong-task',
    target: true,
    scenario: false,
    minimum: 80,
    input: {
      ...base,
      sentence:
        'この報告書には、調査の方法から細かな結果に至るまで、詳しく書かれている。',
    },
  },
  {
    name: 'missing-target',
    target: false,
    scenario: false,
    maximum: 30,
    input: { ...base, sentence: '今日は晴れです。' },
  },
  {
    name: 'simple-accurate-sentence',
    target: true,
    scenario: false,
    minimum: 95,
    input: {
      grammarLevel: 'N4',
      grammarTitle: '～ながら',
      explanation: '同时进行两项动作。',
      connectionRule: '动词ます形去ます＋ながら',
      sentence: '音楽を聞きながら勉強しています。',
    },
  },
];

async function main() {
  if (!process.argv.includes('--run'))
    throw new Error(
      'Pass --run to authorize the four configured-provider requests',
    );
  const config = new ConfigService(process.env);
  const service = new AiReviewService(
    new GeminiReviewProvider(config),
    new DeepSeekReviewProvider(config),
    config,
  );
  const results = [];
  for (const item of cases) {
    try {
      const response = await service.review(item.input);
      const review = response.response.result;
      const passed =
        review.used_target_grammar === item.target &&
        review.scenario_task_completed === item.scenario &&
        review.total_score >= (item.minimum ?? 0) &&
        review.total_score <= (item.maximum ?? 100) &&
        Boolean(review.content_response && review.next_practice);
      results.push({
        name: item.name,
        passed,
        provider: response.provider,
        ...response.response,
      });
      console.log(
        JSON.stringify({
          name: item.name,
          passed,
          provider: response.provider,
          score: review.total_score,
          scenarioCompleted: review.scenario_task_completed,
          latencyMs: response.response.latencyMs,
          usage: response.response.usage,
        }),
      );
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? String(error.code)
          : 'ERROR';
      results.push({ name: item.name, passed: false, code });
      console.log(JSON.stringify({ name: item.name, passed: false, code }));
    }
  }
  const flag = process.argv.indexOf('--output');
  if (flag >= 0 && process.argv[flag + 1])
    await writeFile(process.argv[flag + 1], JSON.stringify(results, null, 2));
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
