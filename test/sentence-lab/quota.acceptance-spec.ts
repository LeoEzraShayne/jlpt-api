import { randomUUID } from 'node:crypto';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { QuotaService } from '../../src/billing/quota.service';
import {
  EntitlementService,
  lockBillingUser,
} from '../../src/billing/entitlement.service';
import type { PrismaService } from '../../src/database/prisma.service';
import type { Prisma } from '@prisma/client';
let h: AcceptanceDatabase;
let quota: QuotaService;
const tx = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  h.prisma.$transaction(fn, { timeout: 20000 });
beforeAll(async () => {
  h = await acceptanceDatabase();
  quota = new QuotaService(h.prisma as PrismaService, new EntitlementService());
  await h.prisma.billingConfig.create({
    data: {
      id: 'default',
      enforcementEnabled: true,
      enforcementAt: new Date(0),
    },
  });
  await h.prisma.grammarPoint.create({
    data: {
      id: 'f-quota-grammar',
      title: 'ながら',
      level: 'N2',
      chineseExplanation: '同时',
    },
  });
});
afterAll(async () => {
  await h?.stop();
});
async function user() {
  return h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'F acceptance',
      timezone: 'Asia/Tokyo',
    },
  });
}
async function task(
  userId: string,
  kind: 'GRAMMAR' | 'VOCABULARY' = 'GRAMMAR',
) {
  if (kind === 'GRAMMAR')
    return h.prisma.studySession.create({
      data: {
        userId,
        grammarId: 'f-quota-grammar',
        mode: 'PRACTICE',
        timerPhaseEndsAt: new Date(),
      },
    });
  const vocabulary = await h.prisma.vocabularyEntry.create({
    data: {
      fingerprint: randomUUID(),
      word: '報告',
      reading: 'ほうこく',
      senseKey: 'report',
      partOfSpeech: ['noun'],
      glosses: [{ language: 'eng', text: 'report' }],
      sourceName: 'F fixture',
      sourceVersion: '1',
      provenance: {},
    },
  });
  const learning = await h.prisma.vocabularyLearning.create({
    data: { userId, vocabularyId: vocabulary.id },
  });
  return h.prisma.vocabularyPractice.create({
    data: {
      userId,
      vocabularyId: vocabulary.id,
      learningId: learning.id,
      learningRevision: 0,
      unknownAtStart: true,
      dueAtStart: true,
      status: 'READY',
    },
  });
}
async function submit(
  userId: string,
  taskKey: string,
  requestKey = randomUUID(),
  kind: 'GRAMMAR' | 'VOCABULARY' = 'GRAMMAR',
) {
  return tx((db) =>
    quota.authorizeSubmission(
      db,
      userId,
      kind,
      taskKey,
      requestKey,
      'same-payload',
    ),
  );
}
const expectCode = async (action: Promise<unknown>, code: string) => {
  await expect(action).rejects.toMatchObject({
    response: expect.objectContaining({ code }),
  });
};

test('mixed grammar/vocabulary concurrent admissions grant exactly five; sixth is refused without consuming a task', async () => {
  const u = await user();
  const tasks = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      task(u.id, i % 2 ? 'VOCABULARY' : 'GRAMMAR'),
    ),
  );
  const results = await Promise.allSettled(
    tasks.map((t, i) =>
      tx((db) =>
        quota.authorizeTask(db, u.id, i % 2 ? 'VOCABULARY' : 'GRAMMAR', t.id),
      ),
    ),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  for (const r of results.filter((r) => r.status === 'rejected'))
    expect((r as PromiseRejectedResult).reason).toMatchObject({
      response: { code: 'DAILY_TASK_LIMIT' },
    });
  expect((await quota.summary(u.id)).quota).toMatchObject({
    remaining: 0,
    reserved: 5,
    consumed: 0,
  });
});

test('three successful or in-flight reviews maximum; duplicate completion never consumes again', async () => {
  const u = await user();
  const t = await task(u.id);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => submit(u.id, t.id)),
  );
  const admitted = results
    .filter(
      (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof submit>>> =>
        r.status === 'fulfilled',
    )
    .map((r) => r.value);
  expect(admitted).toHaveLength(3);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
  await Promise.all(
    admitted.flatMap((s) => [
      tx((db) => quota.completeSubmission(db, s.id)),
      tx((db) => quota.completeSubmission(db, s.id)),
    ]),
  );
  await expectCode(submit(u.id, t.id), 'TASK_REVIEW_LIMIT');
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 1,
    remaining: 4,
  });
  expect(
    await h.prisma.taskAuthorization.findUniqueOrThrow({
      where: { kind_taskKey: { kind: 'GRAMMAR', taskKey: t.id } },
    }),
  ).toMatchObject({ successfulReviews: 3, reservedReviews: 0 });
});

test('system failure releases task and review slots; retry and same-key concurrency are idempotent', async () => {
  const u = await user();
  const t = await task(u.id);
  const key = randomUUID();
  const [one, two] = await Promise.all([
    submit(u.id, t.id, key),
    submit(u.id, t.id, key),
  ]);
  expect(one.id).toBe(two.id);
  await Promise.all([
    tx((db) => quota.failSubmission(db, one.id)),
    tx((db) => quota.failSubmission(db, one.id)),
  ]);
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 0,
    remaining: 5,
  });
  const retried = await submit(u.id, t.id, key);
  expect(retried.id).toBe(one.id);
  await tx((db) => quota.completeSubmission(db, retried.id));
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 0,
    consumed: 1,
    remaining: 4,
  });
  await expectCode(
    tx((db) =>
      quota.authorizeSubmission(
        db,
        u.id,
        'GRAMMAR',
        t.id,
        key,
        'changed-payload',
      ),
    ),
    'IDEMPOTENCY_CONFLICT',
  );
  const stranger = await user();
  await expectCode(submit(stranger.id, t.id, key), 'IDEMPOTENCY_CONFLICT');
  expect((await quota.summary(stranger.id)).quota.consumed).toBe(0);
});

test('timezone edits do not reissue the current period; concurrent next-day requests issue exactly one period', async () => {
  const u = await user();
  const now = new Date('2026-09-13T12:00:00Z');
  const issue = (at: Date) =>
    tx(async (db) => {
      await lockBillingUser(db, u.id);
      return quota.period(db, u.id, at);
    });
  const first = (await issue(now)).period;
  await h.prisma.user.update({
    where: { id: u.id },
    data: { timezone: 'Pacific/Honolulu' },
  });
  const edited = (await issue(new Date('2026-09-13T14:59:59Z'))).period;
  expect(edited.id).toBe(first.id);
  expect(edited.endsAt).toEqual(first.endsAt);
  expect(edited.timezone).toBe('Asia/Tokyo');
  const next = await Promise.all(
    Array.from({ length: 8 }, () => issue(first.endsAt)),
  );
  expect(new Set(next.map((p) => p.period.id)).size).toBe(1);
  expect(next[0].period.endsAt.getTime()).toBeGreaterThan(
    first.endsAt.getTime(),
  );
  expect(await h.prisma.quotaPeriod.count({ where: { userId: u.id } })).toBe(2);
  const skipped = await issue(new Date('2026-10-01T12:00:00Z'));
  expect(skipped.period.dailyLimit).toBe(5);
  expect(await h.prisma.quotaPeriod.count({ where: { userId: u.id } })).toBe(3);
});

test('member corrections have no free cap; expiration retains previous successful count', async () => {
  const u = await user();
  const t = await task(u.id);
  const grant = await h.prisma.entitlementGrant.create({
    data: {
      userId: u.id,
      source: 'STRIPE_TEST',
      sourceKey: randomUUID(),
      durationSeconds: 86400,
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  for (let n = 0; n < 8; n++) {
    const s = await submit(u.id, t.id);
    await tx((db) => quota.completeSubmission(db, s.id));
  }
  expect((await quota.summary(u.id)).quota.consumed).toBe(0);
  await h.prisma.entitlementGrant.update({
    where: { id: grant.id },
    data: { endsAt: new Date(Date.now() - 1) },
  });
  await expectCode(submit(u.id, t.id), 'TASK_REVIEW_LIMIT');
  expect((await quota.summary(u.id)).quota.consumed).toBe(0);
});

test('historical task is exempt and restored successful task does not charge a new day', async () => {
  const u = await user();
  const t = await task(u.id);
  const s = await submit(u.id, t.id);
  await tx((db) => quota.completeSubmission(db, s.id));
  await h.prisma.quotaPeriod.updateMany({
    where: { userId: u.id },
    data: { endsAt: new Date(Date.now() - 1) },
  });
  await tx((db) => quota.authorizeTask(db, u.id, 'GRAMMAR', t.id));
  expect((await quota.summary(u.id)).quota).toMatchObject({
    consumed: 0,
    reserved: 0,
    remaining: 5,
  });
  const old = await task(u.id);
  await h.prisma.studySession.update({
    where: { id: old.id },
    data: { createdAt: new Date('2020-01-01') },
  });
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { enforcementAt: new Date('2021-01-01') },
  });
  expect(
    (await tx((db) => quota.authorizeTask(db, u.id, 'GRAMMAR', old.id))).source,
  ).toBe('EXEMPT');
});

test('daily allowance is used before nonexpiring reward; failure restores reward balance', async () => {
  const u = await user();
  await quota.summary(u.id);
  await h.prisma.quotaAccount.update({
    where: { userId: u.id },
    data: { rewardBalance: 2 },
  });
  for (let i = 0; i < 5; i++) {
    const t = await task(u.id);
    const s = await submit(u.id, t.id);
    await tx((db) => quota.completeSubmission(db, s.id));
  }
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(2);
  const bonus = await task(u.id);
  const s = await submit(u.id, bonus.id);
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(1);
  await tx((db) => quota.failSubmission(db, s.id));
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(2);
  const retry = await submit(u.id, bonus.id);
  await tx((db) => quota.completeSubmission(db, retry.id));
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(1);
});
