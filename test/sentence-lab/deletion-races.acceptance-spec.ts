import { Client } from 'pg';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import {
  createDeletionFixture,
  rehearseDeletion,
  syntheticReview,
} from '../../scripts/deletion/synthetic-rehearsal';
import { deleteAccount } from '../../scripts/deletion/operator';
import type { AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { MeteredAiClient } from '../../src/ai/metered-ai-client';
import { AuthService } from '../../src/auth/auth.service';
import {
  lockBillingUser,
  EntitlementService,
} from '../../src/billing/entitlement.service';
import { AdmobVerifier } from '../../src/android-commerce/admob-verifier';
import { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';
import {
  AndroidPolicy,
  androidHash,
} from '../../src/android-commerce/android.policy';
let h: AcceptanceDatabase;
beforeEach(() => {
  jest
    .spyOn(global, 'fetch')
    .mockRejectedValue(new Error('EXTERNAL_NETWORK_FORBIDDEN'));
});
afterEach(async () => {
  jest.restoreAllMocks();
  await h?.stop();
});
async function fixture() {
  const f = await createDeletionFixture();
  h = f.h;
  return f;
}
async function reviewed(userId: string) {
  const preview = await deleteAccount(h.sql, userId);
  return { ...syntheticReview(userId), planDigest: preview.planDigest };
}
async function waitForLock(observer: Client, pid: number) {
  const until = Date.now() + 1200;
  while (Date.now() < until) {
    const row = await observer.query<{ waiting: boolean }>(
      "SELECT wait_event_type='Lock' AS waiting FROM pg_stat_activity WHERE pid=$1",
      [pid],
    );
    if (row.rows[0]?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('EXPECTED_REAL_DATABASE_LOCK_WAIT');
}

test('tombstone clears profile, rejects direct late auth/learning/quota writes, and is immutable', async () => {
  const f = await fixture();
  await rehearseDeletion(h, { applySynthetic: true });
  const row = await h.prisma.user.findUniqueOrThrow({
    where: { id: f.user.id },
  });
  expect(row).toMatchObject({
    displayName: 'Deleted account',
    avatarUrl: null,
    role: 'USER',
    googlePlayAccountId: f.user.googlePlayAccountId,
  });
  expect(row.email).toMatch(/^[a-f0-9-]+@deleted\.invalid$/);
  expect(row.deletedAt).not.toBeNull();
  await expect(
    h.prisma.authAccount.create({
      data: {
        userId: row.id,
        provider: 'google',
        providerAccountId: randomUUID(),
      },
    }),
  ).rejects.toThrow();
  await expect(
    h.prisma.authSession.create({
      data: {
        userId: row.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    }),
  ).rejects.toThrow();
  await expect(
    h.prisma.studySession.create({
      data: {
        userId: row.id,
        grammarId: f.grammar.id,
        mode: 'PRACTICE',
        timerPhaseEndsAt: new Date(),
      },
    }),
  ).rejects.toThrow();
  await expect(
    h.prisma.quotaAccount.create({ data: { userId: row.id } }),
  ).rejects.toThrow();
  await expect(
    h.prisma.user.update({
      where: { id: row.id },
      data: { deletedAt: null, email: f.user.email },
    }),
  ).rejects.toThrow();
  await expect(
    h.prisma.$transaction((tx) => lockBillingUser(tx, row.id)),
  ).rejects.toThrow();
  const repeated = await rehearseDeletion(h, { applySynthetic: true });
  expect(repeated.mode).toBe('ALREADY_DELETED');
  expect(repeated.completedAt).toEqual(row.deletedAt);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: row.id } }))
      .deletedAt,
  ).toEqual(row.deletedAt);
});

test('review is mandatory for apply and a changed inventory requires a new review', async () => {
  const f = await fixture();
  await expect(
    deleteAccount(h.sql, f.user.id, { apply: true }),
  ).rejects.toThrow();
  const review = await reviewed(f.user.id);
  await h.prisma.quotaPeriod.create({
    data: {
      userId: f.user.id,
      timezone: 'UTC',
      startsAt: new Date(Date.now() + 86400_000),
      endsAt: new Date(Date.now() + 172800_000),
    },
  });
  await expect(
    deleteAccount(h.sql, f.user.id, { apply: true, review }),
  ).rejects.toThrow('DELETION_PLAN_CHANGED_REVIEW_AGAIN');
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
      .deletedAt,
  ).toBeNull();
});

test('late SSV cannot revive reward balance and direct grant writes remain revoked', async () => {
  const f = await fixture();
  const ticket = await h.prisma.rewardTicket.findFirstOrThrow();
  const customData = 'a'.repeat(43);
  await h.prisma.rewardTicket.update({
    where: { id: ticket.id },
    data: { secretHash: androidHash(customData) },
  });
  const verifier = new AdmobVerifier();
  jest.spyOn(verifier, 'verify').mockResolvedValue({
    custom_data: customData,
    timestamp: String(ticket.issuedAt.getTime()),
    transaction_id: 'synthetic_reward',
    reward_amount: '1',
    user_id: ticket.ssvUserId,
    ad_unit: ticket.ssvAdUnitId,
    reward_item: ticket.rewardItem,
  });
  const service = new AdmobRewardService(
    h.prisma as PrismaService,
    new AndroidPolicy(new ConfigService({ DATABASE_URL: h.connectionString })),
    new EntitlementService(),
    verifier,
  );
  await rehearseDeletion(h, { applySynthetic: true });
  await expect(service.receive('synthetic-verified-query')).rejects.toThrow();
  expect(
    await h.prisma.quotaAccount.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  const changed = await h.prisma.entitlementGrant.update({
    where: { orderId: f.order.id },
    data: { status: 'ACTIVE' },
  });
  expect(changed.status).toBe('REVOKED');
  expect(global.fetch).not.toHaveBeenCalled();
});

test('old Web session expires; subsequent Google login creates a new unprivileged account without old history or purchase identity', async () => {
  const f = await fixture();
  const account = await h.prisma.authAccount.findFirstOrThrow();
  const raw = 'synthetic-session';
  const secret = 'synthetic-secret';
  await h.prisma.authSession.updateMany({
    data: {
      tokenHash: createHash('sha256').update(`${raw}:${secret}`).digest('hex'),
    },
  });
  const auth = new AuthService(
    h.prisma as PrismaService,
    new ConfigService({ SESSION_SECRET: secret }),
  );
  expect((await auth.authenticate(raw)).user.id).toBe(f.user.id);
  await rehearseDeletion(h, { applySynthetic: true });
  await expect(auth.authenticate(raw)).rejects.toThrow();
  const fresh = await auth.loginWithGoogle({
    providerId: account.providerAccountId,
    email: f.user.email,
    displayName: 'New synthetic account',
    avatarUrl: undefined,
  });
  expect(fresh.user.id).not.toBe(f.user.id);
  expect(fresh.user.googlePlayAccountId).toBeNull();
  expect(
    await h.prisma.studySession.count({ where: { userId: fresh.user.id } }),
  ).toBe(0);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: fresh.user.id } }),
  ).toBe(0);
  expect(
    await h.prisma.authAccount.count({ where: { userId: f.user.id } }),
  ).toBe(0);
});

test('already admitted AI request finishes costs with no user/task association; a subsequent attempt never sends', async () => {
  const f = await fixture();
  let networkStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    networkStarted = resolve;
  });
  let complete!: (response: Response) => void;
  jest.mocked(global.fetch).mockImplementation(() => {
    networkStarted();
    return new Promise<Response>((resolve) => {
      complete = resolve;
    });
  });
  const client = new MeteredAiClient(
    new ConfigService({
      DEEPSEEK_API_KEY: 'synthetic',
      DEEPSEEK_MODEL: 'deepseek-flash',
    }),
    h.prisma as PrismaService,
  );
  const request = client.request(
    'DEEPSEEK',
    'synthetic prompt',
    'GRAMMAR_REVIEW',
    { userId: f.user.id, taskKey: f.study.id },
    () => true,
  );
  await started;
  await rehearseDeletion(h, { applySynthetic: true });
  complete(
    new Response(
      JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      }),
      { status: 200 },
    ),
  );
  await request;
  const records = await h.prisma.aiUsageRecord.findMany();
  expect(
    records.every(
      (r) => r.userId === null && r.taskKey === null && r.taskKind === null,
    ),
  ).toBe(true);
  expect(
    records.find((r) => r.model === 'deepseek-flash')?.costUsd,
  ).not.toBeNull();
  await expect(
    client.request(
      'DEEPSEEK',
      'must not send',
      'GRAMMAR_REVIEW',
      { userId: f.user.id },
      () => true,
    ),
  ).rejects.toMatchObject({ code: 'AI_METERING_UNAVAILABLE' });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('deletion holding the subject lock rejects a concurrently admitted scalar quota write after commit', async () => {
  const f = await fixture();
  const writer = new Client({ connectionString: h.connectionString });
  await writer.connect();
  try {
    const pid = (
      await writer.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
    ).rows[0].pid;
    await h.sql.query('BEGIN');
    await h.sql.query('SELECT id FROM "User" WHERE id=$1 FOR UPDATE', [
      f.user.id,
    ]);
    await h.sql.query(
      'UPDATE "User" SET "deletedAt"=CURRENT_TIMESTAMP WHERE id=$1',
      [f.user.id],
    );
    const pending = writer.query(
      'INSERT INTO "QuotaPeriod" (id,"userId",timezone,"startsAt","endsAt") VALUES ($1,$2,\'UTC\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
      [randomUUID(), f.user.id],
    );
    const settled = pending.then(
      () => 'unexpected-success',
      () => 'blocked',
    );
    await waitForLock(h.sql, pid);
    await h.sql.query('COMMIT');
    expect(await settled).toBe('blocked');
    expect(
      await h.prisma.quotaPeriod.count({ where: { userId: f.user.id } }),
    ).toBe(1);
  } finally {
    await writer.end();
  }
});

test('a concurrent grant transaction is serialized before deletion and its committed grant is then revoked', async () => {
  const f = await fixture();
  const grants = new EntitlementService(
    new ConfigService({ BILLING_ENVIRONMENT: 'test' }),
  );
  await h.prisma.entitlementGrant.deleteMany();
  const review = await reviewed(f.user.id);
  const pid = (
    await h.sql.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  ).rows[0].pid;
  const observer = new Client({ connectionString: h.connectionString });
  await observer.connect();
  let locked!: () => void, release!: () => void;
  const lockedPromise = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const releasePromise = new Promise<void>((resolve) => {
    release = resolve;
  });
  const grant = h.prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, f.user.id);
    locked();
    await releasePromise;
    await grants.grantOrder(tx, f.order.id, new Date());
  });
  await lockedPromise;
  try {
    const deletion = deleteAccount(h.sql, f.user.id, { apply: true, review });
    const outcome = deletion.then(
      () => 'unexpected-apply',
      (error: unknown) => (error instanceof Error ? error.message : 'unknown'),
    );
    await waitForLock(observer, pid);
    release();
    await grant;
    expect(await outcome).toBe('DELETION_PLAN_CHANGED_REVIEW_AGAIN');
    await rehearseDeletion(h, { applySynthetic: true });
  } finally {
    release();
    await observer.end();
  }
  expect(
    await h.prisma.entitlementGrant.count({
      where: { userId: f.user.id, status: 'ACTIVE' },
    }),
  ).toBe(0);
});

test('actual child-first/User-first deadlock aborts one whole transaction; deletion never partially commits', async () => {
  const f = await fixture();
  const review = await reviewed(f.user.id);
  const pid = (
    await h.sql.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  ).rows[0].pid;
  const writer = new Client({ connectionString: h.connectionString });
  await writer.connect();
  try {
    await writer.query('BEGIN');
    await writer.query('SELECT id FROM "StudySession" WHERE id=$1 FOR UPDATE', [
      f.study.id,
    ]);
    const deletion = deleteAccount(h.sql, f.user.id, {
      apply: true,
      review,
    }).then(
      () => ({ committed: true, code: '' }),
      (error: { code?: string }) => ({
        committed: false,
        code: error.code ?? '',
      }),
    );
    await waitForLock(writer, pid);
    const update = writer
      .query('UPDATE "StudySession" SET "activeSeconds"=1 WHERE id=$1', [
        f.study.id,
      ])
      .then(
        async () => {
          await writer.query('COMMIT');
          return { committed: true, code: '' };
        },
        async (error: { code?: string }) => {
          await writer.query('ROLLBACK');
          return { committed: false, code: error.code ?? '' };
        },
      );
    const [removed, written] = await Promise.all([deletion, update]);
    expect([removed.code, written.code]).toContain('40P01');
    expect(Number(removed.committed) + Number(written.committed)).toBe(1);
    const user = await h.prisma.user.findUniqueOrThrow({
      where: { id: f.user.id },
    });
    if (removed.committed) {
      expect(user.deletedAt).not.toBeNull();
      expect(await h.prisma.authSession.count()).toBe(0);
      expect(await h.prisma.studySession.count()).toBe(0);
    } else {
      expect(user.deletedAt).toBeNull();
      expect(user.email).toBe(f.user.email);
      expect(await h.prisma.authSession.count()).toBe(1);
      expect(await h.prisma.quotaAccount.count()).toBe(1);
      expect(
        (await h.prisma.paymentOrder.findFirstOrThrow()).checkoutUrl,
      ).not.toBeNull();
      // Explicit fresh preview/review, never blind retry of the failed mutation.
      await rehearseDeletion(h, { applySynthetic: true });
      expect(
        (await h.prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
          .deletedAt,
      ).not.toBeNull();
    }
  } finally {
    await writer.query('ROLLBACK');
    await writer.end();
  }
});
