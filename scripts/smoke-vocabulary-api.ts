/** Deploy smoke: creates only uniquely named synthetic users and private data, then removes them. */
import 'dotenv/config';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../src/database/prisma.service';

type PublicPractice = {
  id: string;
  status: string;
  hintLevel: number;
  reference?: unknown;
  challenge?: unknown;
  result?: { outcome: string };
  errorCode?: string;
};
async function main() {
  if (!process.argv.includes('--run'))
    throw new Error('Pass --run to create and remove synthetic smoke fixtures');
  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  const base =
    process.env.VOCABULARY_SMOKE_API_URL ?? 'http://127.0.0.1:4500/api/v1';
  const created: string[] = [];
  async function fixture() {
    const user = await prisma.user.create({
      data: {
        email: `vocabulary-smoke-${randomUUID()}@example.test`,
        displayName: 'Vocabulary smoke fixture',
        learningV2Enabled: true,
      },
    });
    created.push(user.id);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256')
      .update(`${token}:${config.getOrThrow<string>('SESSION_SECRET')}`)
      .digest('hex');
    await prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    async function call<T>(
      path: string,
      method = 'GET',
      body?: unknown,
      status = method === 'POST' ? 201 : 200,
    ): Promise<T> {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          origin: config.getOrThrow<string>('FRONTEND_URL'),
          cookie: `jlpt_session=${token}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
      assert.equal(response.status, status, `${method} ${path} HTTP status`);
      if (status === 404) return undefined as T;
      const envelope = (await response.json()) as { data: T };
      return envelope.data;
    }
    return { user, call };
  }
  try {
    const a = await fixture();
    const b = await fixture();
    const word = await prisma.vocabularyEntry.create({
      data: {
        ownerId: a.user.id,
        fingerprint: `smoke-${randomUUID()}`,
        word: '報告',
        reading: 'ほうこく',
        senseKey: 'report',
        partOfSpeech: ['noun'],
        glosses: [{ language: 'eng', text: 'report; information' }],
        chineseGloss: '报告；汇报',
        level: 'N2',
        sourceName: 'Synthetic deployment smoke',
        sourceVersion: 'v1',
        provenance: {},
        validationStatus: 'VALIDATED',
      },
    });
    await b.call(
      `/vocabulary/${word.id}/learning`,
      'PATCH',
      { action: 'PRACTICE' },
      404,
    );
    await a.call(`/vocabulary/${word.id}/learning`, 'PATCH', {
      action: 'PRACTICE',
    });
    const practice = await a.call<PublicPractice>(
      '/vocabulary-practices',
      'POST',
      { vocabularyId: word.id },
    );
    const repeated = await a.call<PublicPractice>(
      '/vocabulary-practices',
      'POST',
      { vocabularyId: word.id },
    );
    assert.equal(practice.id, repeated.id);
    await b.call(`/vocabulary-practices/${practice.id}`, 'GET', undefined, 404);
    async function until(expected: string) {
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        const current = await a.call<PublicPractice>(
          `/vocabulary-practices/${practice.id}`,
        );
        if (current.status === expected) return current;
        if (current.status === 'FAILED')
          throw new Error(`Vocabulary worker ${current.errorCode ?? 'failed'}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('Vocabulary worker timeout');
    }
    const ready = await until('READY');
    assert.equal(ready.reference, undefined);
    assert.equal(ready.challenge, undefined);
    assert.ok(!JSON.stringify(ready).includes('ほうこく'));
    const answer = {
      sentence: '調査が終わったので、結果を報告します。',
      requestKey: randomUUID(),
    };
    await a.call(`/vocabulary-practices/${practice.id}/answer`, 'POST', answer);
    await a.call(`/vocabulary-practices/${practice.id}/answer`, 'POST', answer);
    const completed = await until('COMPLETED');
    assert.equal(completed.result?.outcome, 'INDEPENDENT');
    const learning = await prisma.vocabularyLearning.findUniqueOrThrow({
      where: {
        userId_vocabularyId: { userId: a.user.id, vocabularyId: word.id },
      },
    });
    assert.ok(learning.nextReviewAt && learning.nextReviewAt > new Date());
    assert.equal(
      await prisma.reviewEvent.count({ where: { userId: a.user.id } }),
      0,
    );
    await a.call(`/vocabulary/${word.id}/learning`, 'PATCH', {
      action: 'REMEMBERED',
    });
    await a.call(`/vocabulary/${word.id}/learning`, 'PATCH', {
      action: 'STOP_PRACTICE',
    });
    const summary = await a.call<{
      dueCount: number;
      completedTodayCount: number;
    }>('/vocabulary-learning/summary');
    assert.equal(summary.dueCount, 0);
    assert.equal(summary.completedTodayCount, 1);
    const history = await a.call<PublicPractice[]>(
      `/vocabulary/${word.id}/learning-history`,
    );
    assert.equal(history.length, 1);
    console.log(
      JSON.stringify({
        passed: true,
        checks: [
          'private account isolation',
          'resume duplicate start',
          'hidden target',
          'live async generation and assessment',
          'immutable replay',
          'FSRS due date',
          'no grammar evidence',
          'manual remembered',
          'history',
        ],
        outcome: completed.result?.outcome,
      }),
    );
  } finally {
    for (const id of created) await prisma.user.delete({ where: { id } });
    await prisma.$disconnect();
    console.log(JSON.stringify({ syntheticUsersRemoved: created.length }));
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Vocabulary smoke failed',
  );
  process.exitCode = 1;
});
