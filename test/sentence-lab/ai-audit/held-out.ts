/** Frozen F-only fixtures, never supplied to D before its c32e91e implementation.
 * Explicit 12-call ceiling; one provider, no retry, real disposable Postgres receipts.
 * Credential file is parsed for DEEPSEEK_API_KEY only. No .env config side effects.
 */
import { access, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase } from '../database';
import { DeepSeekReviewProvider } from '../../../src/ai/deepseek.provider';
import { ProviderError } from '../../../src/ai/ai-provider';
import type { PrismaService } from '../../../src/database/prisma.service';
import { VocabularyAiService } from '../../../src/vocabulary-learning/vocabulary-ai.service';
import type {
  AiVocabularyInput,
  Challenge,
} from '../../../src/vocabulary-learning/vocabulary-ai.schema';
const fixtures = [
  {
    id: 'stem-wrong',
    title: '～やすい',
    meaning: '容易做某事',
    connection: '动词ます形去ます＋やすい',
    sentence: 'このペンは書くやすいです。',
    target: true,
    correct: false,
  },
  {
    id: 'stem-valid',
    title: '～やすい',
    meaning: '容易做某事',
    connection: '动词ます形去ます＋やすい',
    sentence: 'このペンは書きやすいです。',
    target: true,
    correct: true,
  },
  {
    id: 'obligation',
    title: '～ないわけにはいかない',
    meaning: '由于责任等原因不能不做，即必须做',
    connection: '动词ない形＋わけにはいかない',
    sentence: '締め切りが明日なので、提出しないわけにはいかない。',
    target: true,
    correct: true,
    semanticExpected: 'must submit; cannot leave it unsubmitted',
  },
  {
    id: 'prohibition',
    title: '～わけにはいかない',
    meaning: '由于社会责任或情理不能做',
    connection: '动词辞书形＋わけにはいかない',
    sentence: '秘密が書いてあるので、この書類を提出するわけにはいかない。',
    target: true,
    correct: true,
    semanticExpected:
      'cannot submit this document because it contains a secret',
  },
];
async function main() {
  if (!process.argv.includes('--run')) throw Error('EXPLICIT_RUN_REQUIRED');
  const folder = 'test/sentence-lab/ai-audit';
  const tag =
    process.argv.find((a) => a.startsWith('--tag='))?.slice(6) ?? 'held-out';
  if (!/^[a-z0-9-]+$/.test(tag)) throw Error('INVALID_OUTPUT_TAG');
  for (const kind of ['raw', 'results', 'usage']) {
    if (
      await access(`${folder}/${tag}-${kind}.json`).then(
        () => true,
        () => false,
      )
    )
      throw Error('F_IMMUTABLE_OUTPUT_ALREADY_EXISTS');
  }
  const credentialFile = process.env.F_CREDENTIAL_FILE;
  if (!credentialFile) throw Error('CREDENTIAL_FILE_REQUIRED');
  const key = parse(await readFile(credentialFile, 'utf8')).DEEPSEEK_API_KEY;
  if (!key) throw Error('DEEPSEEK_CREDENTIAL_MISSING');
  const config = new ConfigService({
    DEEPSEEK_API_KEY: key,
    DEEPSEEK_MODEL: 'deepseek-flash',
    AI_PRIMARY_PROVIDER: 'DEEPSEEK',
  });
  const h = await acceptanceDatabase();
  const db = h.prisma as PrismaService;
  const grammar = new DeepSeekReviewProvider(config, db),
    vocab = new VocabularyAiService(config, db);
  const runId = new Date().toISOString(),
    rows: unknown[] = [],
    raw: unknown[] = [];
  let currentCase = '',
    calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (...args) => {
    if (++calls > 12) throw Error('F_CALL_BUDGET_EXCEEDED');
    const response = await originalFetch(...args);
    if (response.ok) {
      const envelope = (await response.clone().json()) as {
        choices?: { message?: { content?: string } }[];
        model?: string;
        usage?: unknown;
      };
      raw.push({
        caseId: currentCase,
        model: envelope.model,
        content: envelope.choices?.[0]?.message?.content,
        usage: envelope.usage,
      });
      await writeFile(
        `${folder}/${tag}-raw.json`,
        JSON.stringify({ runId, raw }, null, 2),
        { mode: 0o600 },
      );
    }
    return response;
  };
  const capture = async (
    id: string,
    locale: string,
    input: unknown,
    op: () => Promise<unknown>,
  ) => {
    currentCase = `${locale}:${id}`;
    try {
      rows.push({ caseId: currentCase, input, result: await op() });
    } catch (e) {
      rows.push({
        caseId: currentCase,
        input,
        error:
          e instanceof ProviderError ? e.code : 'UNEXPECTED_EVALUATION_ERROR',
      });
    }
    await writeFile(
      `${folder}/${tag}-results.json`,
      JSON.stringify(
        {
          runId,
          implementation: 'c32e91eb99c9ce388b13d33084e78bb39e4bacbc',
          fixtureSha256: createHash('sha256')
            .update(JSON.stringify(fixtures))
            .digest('hex'),
          rows,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.log(currentCase, 'recorded');
  };
  try {
    for (const locale of ['zh', 'en'] as const) {
      for (const c of fixtures)
        await capture(c.id, locale, c, async () => {
          const response = await grammar.review({
            stage: 'CORE',
            explanationLocale: locale,
            grammarTitle: c.title,
            explanation: c.meaning,
            connectionRule: c.connection,
            sentence: c.sentence,
            usageContext: {
              taskKind: 'F_HELD_OUT',
              taskKey: `${runId}:${locale}:${c.id}`,
              attempt: 1,
            },
          });
          const r = response.result;
          return {
            ...response,
            structuralExpectationPassed:
              r.used_target_grammar === c.target &&
              r.target_grammar_correct === c.correct &&
              (c.correct
                ? r.total_score >= 90 && r.error_spans.length === 0
                : r.total_score <= 59 && r.error_spans.length > 0),
          };
        });
      const input: AiVocabularyInput = {
        explanationLocale: locale,
        word: '予約',
        reading: 'よやく',
        chineseGloss: '预订座位等',
        senseKey: 'F-reservation',
        glosses: [{ language: 'eng', text: 'reservation; booking' }],
        grammars: [],
        previousPrompts: [],
      };
      const challenge: Challenge = {
        promptZh:
          locale === 'en'
            ? 'Tell a friend that you booked restaurant seats for tomorrow. Answer in Japanese.'
            : '用日语告诉朋友你已经预订了明天餐厅的座位。',
        meaningHintZh:
          locale === 'en' ? 'Book something in advance.' : '提前预订。',
        grammarId: null,
        referenceSentence: '明日のレストランの席を予約しました。',
        referenceFurigana:
          '明日[あした]のレストランの席[せき]を予約[よやく]しました。',
        referenceTranslationZh:
          locale === 'en'
            ? 'I booked restaurant seats for tomorrow.'
            : '我预订了明天餐厅的座位。',
        chunks: ['明日のレストランの席を', '予約しました。'],
      };
      for (const [id, sentence, target] of [
        ['reservation-target', '明日のレストランの席を予約しました。', true],
        [
          'reservation-alternative',
          '明日のレストランの席を取っておきました。',
          false,
        ],
      ] as const) {
        await capture(
          id,
          locale,
          { vocabulary: input, challenge, sentence, expectedTarget: target },
          async () => {
            const assessment = await vocab.assess(input, challenge, sentence, {
              taskKind: 'F_HELD_OUT',
              taskKey: `${runId}:${locale}:${id}`,
              attempt: 1,
            });
            return {
              assessment,
              structuralExpectationPassed:
                assessment.usedTarget === target &&
                assessment.targetCorrect === (target ? true : null) &&
                assessment.meaningCorrect === (target ? true : null) &&
                assessment.readingCorrect === null,
            };
          },
        );
      }
    }
  } finally {
    global.fetch = originalFetch;
    const usage = await db.aiUsageRecord.findMany({
      where: { taskKind: 'F_HELD_OUT', taskKey: { startsWith: runId } },
      orderBy: { createdAt: 'asc' },
    });
    await writeFile(
      `${folder}/${tag}-usage.json`,
      JSON.stringify(usage, null, 2),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        calls,
        receipts: usage.length,
        knownCostUsd: usage.reduce((s, r) => s + Number(r.costUsd ?? 0), 0),
        unknownCostCalls: usage.filter((r) => r.costUsd === null).length,
      }),
    );
    await h.stop();
  }
}
main().catch(() => {
  console.error('F_HELD_OUT_RUN_FAILED');
  process.exitCode = 1;
});
