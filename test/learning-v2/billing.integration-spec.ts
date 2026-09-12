import { StripeWebhookService } from '../../src/billing/stripe-webhook.service';
import type Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness } from './harness';
import { QuotaService } from '../../src/billing/quota.service';
import {
  EntitlementService,
  lockBillingUser,
} from '../../src/billing/entitlement.service';
import {
  catalogFor,
  DAY_SECONDS,
  GIFT_EMAIL,
} from '../../src/billing/billing.policy';
import { ConfigService } from '@nestjs/config';
import { localDayBounds } from '../../src/vocabulary-learning/vocabulary-learning.service';
let h: Harness;
let quota: QuotaService;
let grants: EntitlementService;
beforeAll(async () => {
  h = await startHarness();
  quota = h.app.get(QuotaService);
  grants = h.app.get(EntitlementService);
});
afterAll(async () => {
  await h?.stop();
});
beforeEach(async () => {
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: {
      salesEnabled: true,
      enforcementEnabled: true,
      launchAt: new Date(Date.now() - DAY_SECONDS * 1000),
      enforcementAt: new Date(0),
    },
    update: {
      salesEnabled: true,
      enforcementEnabled: true,
      launchAt: new Date(Date.now() - DAY_SECONDS * 1000),
      enforcementAt: new Date(0),
    },
  });
});
async function user() {
  return (await h.login(`billing-${randomUUID()}`)).user;
}
async function task(userId: string) {
  return h.prisma.studySession.create({
    data: {
      userId,
      grammarId: 'f-N1-0',
      mode: 'PRACTICE',
      timerPhaseEndsAt: new Date(),
    },
  });
}
async function reserve(userId: string, id: string) {
  return h.prisma.$transaction((tx) =>
    quota.authorizeTask(tx, userId, 'GRAMMAR', id),
  );
}
async function submit(userId: string, id: string, key: string = randomUUID()) {
  return h.prisma.$transaction((tx) =>
    quota.authorizeSubmission(tx, userId, 'GRAMMAR', id, key, key),
  );
}
async function order(userId: string, durationSeconds = DAY_SECONDS) {
  return h.prisma.paymentOrder.create({
    data: {
      userId,
      provider: 'STRIPE',
      environment: 'test',
      productCode: 'DAY_PASS',
      market: 'GLOBAL',
      currency: 'USD',
      amount: 99,
      durationSeconds,
      requestKey: randomUUID(),
      snapshot: {},
    },
  });
}
async function give(userId: string, duration = DAY_SECONDS, at = new Date()) {
  const row = await order(userId, duration);
  await h.prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, userId);
    await grants.grantOrder(tx, row.id, at);
  });
  return row;
}

test('concurrent sixth task loses atomically; success consumes once and failures release', async () => {
  const u = await user();
  const tasks = await Promise.all(Array.from({ length: 6 }, () => task(u.id)));
  const results = await Promise.allSettled(
    tasks.map((t) => reserve(u.id, t.id)),
  );
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 5,
    remaining: 0,
    consumed: 0,
  });
  const index = results.findIndex((r) => r.status === 'fulfilled');
  const sub = await submit(u.id, tasks[index].id);
  await Promise.all(
    [1, 2].map(() =>
      h.prisma.$transaction((tx) =>
        quota.completeSubmission(tx, sub.id, 'result'),
      ),
    ),
  );
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 4,
    consumed: 1,
  });
  const another = results.findIndex(
    (r, i) => r.status === 'fulfilled' && i !== index,
  );
  const failed = await submit(u.id, tasks[another].id);
  await h.prisma.$transaction((tx) => quota.failSubmission(tx, failed.id));
  expect((await quota.summary(u.id)).quota).toMatchObject({
    reserved: 3,
    consumed: 1,
    remaining: 1,
  });
});

test('successful plus in-flight correction cap, failed-slot retry, duplicates and owner isolation', async () => {
  const u = await user();
  const other = await user();
  const t = await task(u.id);
  const results = await Promise.allSettled(
    Array.from({ length: 4 }, () => submit(u.id, t.id)),
  );
  const successful = results.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  );
  expect(successful).toHaveLength(3);
  expect(results.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { status: 402 },
  });
  await expect(
    submit(other.id, t.id, successful[0].requestKey),
  ).rejects.toMatchObject({ status: 409 });
  expect((await submit(u.id, t.id, successful[0].requestKey)).id).toBe(
    successful[0].id,
  );
  await h.prisma.$transaction((tx) =>
    quota.failSubmission(tx, successful[0].id),
  );
  const retry = await submit(u.id, t.id, successful[0].requestKey);
  expect(retry.id).toBe(successful[0].id);
  for (const sub of successful)
    await h.prisma.$transaction((tx) => quota.completeSubmission(tx, sub.id));
  await expect(submit(u.id, t.id)).rejects.toMatchObject({ status: 402 });
  expect((await quota.summary(u.id)).quota.consumed).toBe(1);
});

test('rewards survive periods, daily slots are preferred, expired idle rewards return without duplication', async () => {
  const u = await user();
  await quota.summary(u.id);
  await h.prisma.quotaAccount.update({
    where: { userId: u.id },
    data: { rewardBalance: 2 },
  });
  for (let i = 0; i < 5; i++) {
    const t = await task(u.id);
    await reserve(u.id, t.id);
  }
  const t = await task(u.id);
  const auth = await reserve(u.id, t.id);
  expect(auth.source).toBe('REWARD');
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(1);
  await h.prisma.taskAuthorization.update({
    where: { id: auth.id },
    data: { expiresAt: new Date(0) },
  });
  await quota.reconcileReservations();
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(2);
  await reserve(u.id, t.id);
  const sub = await submit(u.id, t.id);
  await h.prisma.$transaction((tx) => quota.completeSubmission(tx, sub.id));
  expect((await quota.summary(u.id)).quota.rewardBalance).toBe(1);
});

test('timezone edits do not reset a period or create a shortened transition; DST retains calendar midnights', async () => {
  const u = await user();
  const now = new Date('2026-03-08T06:30:00Z');
  await h.prisma.user.update({
    where: { id: u.id },
    data: { timezone: 'America/New_York' },
  });
  const first = await h.prisma.$transaction((tx) =>
    quota.period(tx, u.id, now),
  );
  expect(first.period.endsAt.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  await h.prisma.user.update({
    where: { id: u.id },
    data: { timezone: 'Asia/Tokyo' },
  });
  const unchanged = await h.prisma.$transaction((tx) =>
    quota.period(tx, u.id, new Date(now.getTime() + 1000)),
  );
  expect(unchanged.period.id).toBe(first.period.id);
  const next = await h.prisma.$transaction((tx) =>
    quota.period(tx, u.id, first.period.endsAt),
  );
  expect(
    next.period.endsAt.getTime() - next.period.startsAt.getTime(),
  ).toBeGreaterThanOrEqual(24 * 3600_000);
  expect(
    localDayBounds(
      'America/New_York',
      new Date('2026-11-01T05:00:00Z'),
    ).lt.toISOString(),
  ).toBe('2026-11-02T05:00:00.000Z');
});

test('old tasks stay exempt, members have unlimited success, expiry does not reset correction count', async () => {
  const u = await user();
  const old = await task(u.id);
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { enforcementAt: new Date(Date.now() + 1) },
  });
  expect((await reserve(u.id, old.id)).source).toBe('EXEMPT');
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { enforcementAt: new Date(0) },
  });
  const memberOrder = await give(u.id);
  const t = await task(u.id);
  for (let i = 0; i < 8; i++) {
    const sub = await submit(u.id, t.id);
    await h.prisma.$transaction((tx) => quota.completeSubmission(tx, sub.id));
  }
  expect((await quota.summary(u.id)).quota.consumed).toBe(0);
  await h.prisma.entitlementGrant.update({
    where: { orderId: memberOrder.id },
    data: { endsAt: new Date(0) },
  });
  await expect(submit(u.id, t.id)).rejects.toMatchObject({ status: 402 });
  expect((await reserve(u.id, old.id)).source).toBe('EXEMPT');
});

test('renewal adds exact durations; revocation and suspension preserve all unrelated unconsumed service', async () => {
  const u = await user();
  const now = new Date('2026-01-01T00:00:00Z');
  const first = await give(u.id, DAY_SECONDS, now);
  const second = await give(u.id, DAY_SECONDS, now);
  let rows = await h.prisma.entitlementGrant.findMany({
    where: { userId: u.id },
    orderBy: { startsAt: 'asc' },
  });
  expect(rows[1].endsAt.getTime() - rows[0].startsAt.getTime()).toBe(
    2 * DAY_SECONDS * 1000,
  );
  const half = new Date(now.getTime() + DAY_SECONDS * 500);
  await h.prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, u.id);
    await grants.changeOrderGrant(tx, first.id, 'SUSPENDED', half);
  });
  rows = await h.prisma.entitlementGrant.findMany({ where: { userId: u.id } });
  expect(rows.find((r) => r.orderId === first.id)?.remainingSeconds).toBe(
    DAY_SECONDS / 2,
  );
  expect(rows.find((r) => r.orderId === second.id)?.startsAt).toEqual(half);
  await h.prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, u.id);
    await grants.changeOrderGrant(tx, first.id, 'ACTIVE', half);
  });
  rows = await h.prisma.entitlementGrant.findMany({
    where: { userId: u.id, status: 'ACTIVE' },
    orderBy: { endsAt: 'desc' },
  });
  expect(rows[0].endsAt.getTime() - half.getTime()).toBe(
    1.5 * DAY_SECONDS * 1000,
  );
  await h.prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, u.id);
    await grants.changeOrderGrant(tx, first.id, 'REVOKED', half);
  });
  expect(
    (
      await h.prisma.entitlementGrant.findUniqueOrThrow({
        where: { orderId: second.id },
      })
    ).endsAt.getTime() - half.getTime(),
  ).toBe(DAY_SECONDS * 1000);
});

test('gift is one fixed launch year, never an order or role change, and test payments cannot unlock live access', async () => {
  const u = await user();
  await h.prisma.user.update({
    where: { id: u.id },
    data: { email: GIFT_EMAIL },
  });
  await Promise.all([1, 2, 3].map(() => quota.summary(u.id)));
  const rows = await h.prisma.entitlementGrant.findMany({
    where: { userId: u.id },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0].orderId).toBeNull();
  expect(rows[0].endsAt.getTime() - rows[0].startsAt.getTime()).toBe(
    365 * DAY_SECONDS * 1000,
  );
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role,
  ).toBe('USER');
  const another = await user();
  await give(another.id);
  const live = new EntitlementService(
    new ConfigService({ BILLING_ENVIRONMENT: 'live' }),
  );
  expect(
    (await h.prisma.$transaction((tx) => live.membership(tx, another.id)))
      .isMember,
  ).toBe(false);
});

test('USD/JPY quotes and exclusive 90-day launch boundary are exact', async () => {
  const config = await h.prisma.billingConfig.findUniqueOrThrow({
    where: { id: 'default' },
  });
  const end = new Date(config.launchAt!.getTime() + 90 * DAY_SECONDS * 1000);
  expect(
    catalogFor(config, 'GLOBAL', new Date(end.getTime() - 1)).products.map(
      (p) => p.amount,
    ),
  ).toEqual([99, 6400]);
  expect(
    catalogFor(config, 'GLOBAL', end).products.map((p) => p.amount),
  ).toEqual([99, 9999]);
  expect(catalogFor(config, 'JP', end).products.map((p) => p.amount)).toEqual([
    100, 6400,
  ]);
});

test('concurrent out-of-order provider snapshots retry after revision change; partial refund never regresses', async () => {
  const u = await user();
  const row = await order(u.id);
  const paymentId = `pi_${randomUUID()}`;
  let refunded = 0;
  let disputed = false;
  let retrievals = 0;
  let releaseOld!: () => void;
  let enteredOld!: () => void;
  const entered = new Promise<void>((r) => {
    enteredOld = r;
  });
  const gate = new Promise<void>((r) => {
    releaseOld = r;
  });
  const payment = () => ({
    id: paymentId,
    livemode: false,
    amount: 99,
    currency: 'usd',
    status: 'succeeded',
    metadata: { orderId: row.id, userId: u.id, environment: 'test' },
    latest_charge: {
      id: 'ch_fixture',
      paid: true,
      amount_refunded: refunded,
      created: Math.floor(Date.now() / 1000),
    },
  });
  const gateway = {
    environment: 'test',
    verify: (raw: Buffer) => JSON.parse(raw.toString()) as Stripe.Event,
    stripe: {
      paymentIntents: {
        retrieve: jest.fn(async () => {
          const snapshot = payment();
          retrievals++;
          if (retrievals === 2) {
            enteredOld();
            await gate;
          }
          return snapshot;
        }),
      },
      disputes: {
        list: jest.fn(() =>
          Promise.resolve({
            data: disputed ? [{ status: 'needs_response' }] : [],
          }),
        ),
      },
    },
  };
  const service = new StripeWebhookService(
    h.prisma,
    gateway as unknown as import('../../src/billing/stripe.gateway').StripeGateway,
    grants,
  );
  const payload = (id: string) =>
    Buffer.from(
      JSON.stringify({
        id,
        type: 'payment_intent.succeeded',
        created: 100,
        data: { object: { id: paymentId } },
      }),
    );
  const old = service.receive(payload('evt_old'), 'verified-in-fixture');
  await entered;
  refunded = 20;
  await service.receive(payload('evt_new'), 'verified-in-fixture');
  releaseOld();
  await old;
  expect(retrievals).toBeGreaterThanOrEqual(6);
  expect(
    await h.prisma.paymentOrder.findUnique({ where: { id: row.id } }),
  ).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: 20 });
  await Promise.all(
    [1, 2].map(() =>
      service.receive(payload('evt_new'), 'verified-in-fixture'),
    ),
  );
  expect(
    await h.prisma.entitlementGrant.count({ where: { orderId: row.id } }),
  ).toBe(1);
  disputed = true;
  await service.receive(payload('evt_dispute'), 'verified-in-fixture');
  expect(
    await h.prisma.entitlementGrant.findUnique({ where: { orderId: row.id } }),
  ).toMatchObject({ status: 'SUSPENDED' });
  disputed = false;
  await service.receive(payload('evt_won'), 'verified-in-fixture');
  expect(
    await h.prisma.entitlementGrant.findUnique({ where: { orderId: row.id } }),
  ).toMatchObject({ status: 'ACTIVE' });
  refunded = 99;
  await service.receive(payload('evt_refund'), 'verified-in-fixture');
  expect(
    await h.prisma.entitlementGrant.findUnique({ where: { orderId: row.id } }),
  ).toMatchObject({ status: 'REVOKED' });
  refunded = 0;
  await service.receive(payload('evt_late'), 'verified-in-fixture');
  expect(
    await h.prisma.paymentOrder.findUnique({ where: { id: row.id } }),
  ).toMatchObject({ status: 'REFUNDED', refundedAmount: 99 });
  expect(
    await h.prisma.entitlementGrant.findUnique({ where: { orderId: row.id } }),
  ).toMatchObject({ status: 'REVOKED' });
});
