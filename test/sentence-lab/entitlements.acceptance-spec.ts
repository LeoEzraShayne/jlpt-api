import { randomUUID } from 'node:crypto';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import {
  EntitlementService,
  lockBillingUser,
} from '../../src/billing/entitlement.service';
import { catalogFor } from '../../src/billing/billing.policy';
import type { Prisma } from '@prisma/client';
let h: AcceptanceDatabase;
const entitlements = new EntitlementService();
const day = 86400000;
const now = new Date('2026-09-13T12:00:00Z');
const tx = <T>(fn: (db: Prisma.TransactionClient) => Promise<T>) =>
  h.prisma.$transaction(fn, { timeout: 20000 });
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
async function user(email = `${randomUUID()}@example.test`) {
  return h.prisma.user.create({ data: { email, displayName: 'F membership' } });
}
async function order(userId: string, days = 1) {
  return h.prisma.paymentOrder.create({
    data: {
      userId,
      provider: 'STRIPE',
      environment: 'test',
      productCode: days === 1 ? 'DAY_PASS' : 'YEAR_PASS',
      market: 'GLOBAL',
      currency: 'USD',
      amount: days === 1 ? 99 : 6400,
      durationSeconds: days * 86400,
      requestKey: randomUUID(),
      snapshot: {},
    },
  });
}
async function grant(userId: string, orderId: string, paidAt = now) {
  return tx(async (db) => {
    await lockBillingUser(db, userId);
    return entitlements.grantOrder(db, orderId, paidAt);
  });
}
async function member(userId: string, at = now) {
  return tx((db) => entitlements.membership(db, userId, at));
}
async function change(
  userId: string,
  orderId: string,
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED',
  at: Date,
) {
  return tx(async (db) => {
    await lockBillingUser(db, userId);
    await entitlements.changeOrderGrant(db, orderId, status, at);
  });
}

test.each([1, 365])(
  '%i day purchase uses exact seconds, including exclusive expiry',
  async (days) => {
    const u = await user();
    const o = await order(u.id, days);
    const g = await grant(u.id, o.id);
    expect(g.startsAt).toEqual(now);
    expect(g.endsAt.getTime() - g.startsAt.getTime()).toBe(days * day);
    expect(
      (await member(u.id, new Date(g.endsAt.getTime() - 1))).isMember,
    ).toBe(true);
    expect((await member(u.id, g.endsAt)).isMember).toBe(false);
  },
);

test('concurrent renewal and duplicate paid notifications preserve full purchased duration once', async () => {
  const u = await user();
  const one = await order(u.id);
  const year = await order(u.id, 365);
  await Promise.all([
    grant(u.id, one.id),
    grant(u.id, year.id),
    grant(u.id, one.id),
    grant(u.id, year.id),
  ]);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: u.id } }),
  ).toBe(2);
  expect((await member(u.id)).expiresAt).toEqual(
    new Date(now.getTime() + 366 * day),
  );
});

test('refund removes only its unconsumed source; future purchase moves forward with full duration', async () => {
  const u = await user();
  const one = await order(u.id);
  const year = await order(u.id, 365);
  await grant(u.id, one.id);
  await grant(u.id, year.id);
  const at = new Date(now.getTime() + day / 2);
  await change(u.id, one.id, 'REVOKED', at);
  expect((await member(u.id, at)).expiresAt).toEqual(
    new Date(at.getTime() + 365 * day),
  );
  expect(
    await h.prisma.entitlementGrant.findUniqueOrThrow({
      where: { orderId: year.id },
    }),
  ).toMatchObject({ status: 'ACTIVE', durationSeconds: 365 * 86400 });
  await change(u.id, one.id, 'ACTIVE', at);
  expect((await member(u.id, at)).expiresAt).toEqual(
    new Date(at.getTime() + 365 * day),
  );
});

test('dispute suspension preserves remaining source time; won event restores once after elapsed suspension', async () => {
  const u = await user();
  const o = await order(u.id);
  await grant(u.id, o.id);
  const suspendAt = new Date(now.getTime() + day / 4);
  await change(u.id, o.id, 'SUSPENDED', suspendAt);
  expect((await member(u.id, suspendAt)).isMember).toBe(false);
  const restoredAt = new Date(now.getTime() + 5 * day);
  await change(u.id, o.id, 'ACTIVE', restoredAt);
  await change(u.id, o.id, 'ACTIVE', restoredAt);
  expect((await member(u.id, restoredAt)).expiresAt).toEqual(
    new Date(restoredAt.getTime() + (3 * day) / 4),
  );
  expect(
    await h.prisma.entitlementGrant.count({ where: { orderId: o.id } }),
  ).toBe(1);
});

test('launch catalog 90-day cutoff is exclusive; legacy JP requests use global USD prices', async () => {
  const config = await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', launchAt: now, salesEnabled: true },
    update: { launchAt: now, salesEnabled: true },
  });
  const cutoff = new Date(now.getTime() + 90 * day);
  expect(
    catalogFor(config, 'GLOBAL', new Date(cutoff.getTime() - 1)).products.map(
      (p) => p.amount,
    ),
  ).toEqual([99, 6400]);
  expect(
    catalogFor(config, 'GLOBAL', cutoff).products.map((p) => p.amount),
  ).toEqual([99, 9900]);
  expect(
    catalogFor(config, 'JP', cutoff).products.map((p) => [
      p.currency,
      p.amount,
    ]),
  ).toEqual([
    ['USD', 99],
    ['USD', 9900],
  ]);
});

test('gift is fixed at launch, idempotent and does not create orders or administrator role', async () => {
  const launchAt = new Date(now.getTime() - 10 * day);
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', launchAt },
    update: { launchAt },
  });
  const u = await user('leo.ezra.shayne@gmail.com');
  await Promise.all(
    Array.from({ length: 6 }, () =>
      tx(async (db) => {
        await lockBillingUser(db, u.id);
        return entitlements.ensureGift(db, u.id, now);
      }),
    ),
  );
  const gifts = await h.prisma.entitlementGrant.findMany({
    where: { userId: u.id },
  });
  expect(gifts).toHaveLength(1);
  expect(gifts[0].startsAt).toEqual(launchAt);
  expect(gifts[0].endsAt).toEqual(new Date(launchAt.getTime() + 365 * day));
  expect(await h.prisma.paymentOrder.count({ where: { userId: u.id } })).toBe(
    0,
  );
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role,
  ).toBe('USER');
});

test('test runtime does not grant membership from live order sources', async () => {
  const u = await user();
  await h.prisma.entitlementGrant.create({
    data: {
      userId: u.id,
      source: 'STRIPE_LIVE',
      sourceKey: randomUUID(),
      startsAt: now,
      endsAt: new Date(now.getTime() + day),
      durationSeconds: 86400,
    },
  });
  expect((await member(u.id)).isMember).toBe(false);
});
