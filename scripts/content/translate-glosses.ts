/** Offline enrichment only. Does not add latency/model calls to vocabulary browsing. */
import 'dotenv/config';
import { appendFile, readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import {
  parseTranslations,
  translationPrompt,
} from '../../src/content/vocabulary-translation';
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const output = arg('--output', '/tmp/jlpt-vocabulary-zh.jsonl');
const model = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const source = `AI辅助翻译 · DeepSeek/${model} · zh-v1 · 2026-09-12`;
const auditSchema = z.object({
  fingerprint: z.string(),
  word: z.string(),
  reading: z.string(),
  senseKey: z.string(),
  sourceVersion: z.string(),
  chinese: z.string().min(1),
  source: z.string(),
});
async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  try {
    if (args.includes('--apply')) {
      const rows = (await readFile(arg('--apply', ''), 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((s) => auditSchema.parse(JSON.parse(s) as unknown));
      if (!args.includes('--commit')) {
        console.log(JSON.stringify({ preview: rows.length }));
        return;
      }
      let changed = 0;
      for (const row of rows)
        changed += (
          await db.vocabularyEntry.updateMany({
            where: {
              ownerId: null,
              fingerprint: row.fingerprint,
              word: row.word,
              reading: row.reading,
              senseKey: row.senseKey,
              sourceVersion: row.sourceVersion,
              chineseGloss: null,
              validationStatus: 'VALIDATED',
            },
            data: { chineseGloss: row.chinese, chineseGlossSource: row.source },
          })
        ).count;
      console.log(JSON.stringify({ applied: changed, records: rows.length }));
      return;
    }
    const entries = await db.vocabularyEntry.findMany({
      where: {
        ownerId: null,
        chineseGloss: null,
        validationStatus: 'VALIDATED',
      },
      orderBy: { id: 'asc' },
      take: Number(arg('--limit', '100000')),
    });
    console.log(
      JSON.stringify({
        missing: entries.length,
        commit: args.includes('--commit'),
      }),
    );
    if (!args.includes('--commit')) return;
    if (!process.env.DEEPSEEK_API_KEY)
      throw Error('DeepSeek key is not configured');
    const batchSize = Math.min(
      50,
      Math.max(1, Number(arg('--batch-size', '50'))),
    );
    let cursor = 0,
      done = 0,
      failures = 0;
    async function work() {
      while (cursor < entries.length) {
        const batch = entries.slice(cursor, (cursor += batchSize));
        let translated: string[] | undefined;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetch(
              'https://api.deepseek.com/chat/completions',
              {
                method: 'POST',
                signal: AbortSignal.timeout(60000),
                headers: {
                  'content-type': 'application/json',
                  authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                  model,
                  temperature: 0.1,
                  response_format: { type: 'json_object' },
                  messages: [
                    {
                      role: 'user',
                      content: translationPrompt(
                        batch.map((e) => ({
                          word: e.word,
                          reading: e.reading,
                          senseKey: e.senseKey,
                          glosses: e.glosses,
                        })),
                      ),
                    },
                  ],
                }),
              },
            );
            if (!response.ok) throw Error(`Provider HTTP ${response.status}`);
            const body = (await response.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            translated = parseTranslations(
              body.choices?.[0]?.message?.content ?? '',
              batch.length,
            );
            break;
          } catch (e) {
            console.log(
              JSON.stringify({
                retry: attempt + 1,
                first: batch[0].word,
                error: e instanceof Error ? e.message : 'invalid response',
              }),
            );
            if (attempt < 2)
              await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
        }
        if (!translated) {
          failures += batch.length;
          continue;
        }
        const rows = batch.map((e, index) => ({
          fingerprint: e.fingerprint,
          word: e.word,
          reading: e.reading,
          senseKey: e.senseKey,
          sourceVersion: e.sourceVersion,
          chinese: translated[index],
          source,
        }));
        // Persist a replayable audit before writes; never overwrite existing/editorial Chinese.
        await appendFile(
          output,
          rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
          { mode: 0o600 },
        );
        await db.$transaction(
          rows.map((row) =>
            db.vocabularyEntry.updateMany({
              where: {
                ownerId: null,
                fingerprint: row.fingerprint,
                sourceVersion: row.sourceVersion,
                chineseGloss: null,
                validationStatus: 'VALIDATED',
              },
              data: {
                chineseGloss: row.chinese,
                chineseGlossSource: row.source,
              },
            }),
          ),
        );
        done += rows.length;
        console.log(
          JSON.stringify({
            translated: done,
            total: entries.length,
            failed: failures,
          }),
        );
      }
    }
    await Promise.all(
      Array.from(
        { length: Math.min(8, Math.max(1, Number(arg('--concurrency', '3')))) },
        work,
      ),
    );
    if (failures)
      throw Error(`${failures} senses remain untranslated; rerun to resume`);
  } finally {
    await db.$disconnect();
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Translation failed');
  process.exitCode = 1;
});
