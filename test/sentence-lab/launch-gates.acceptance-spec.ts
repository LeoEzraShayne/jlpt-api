import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import {
  EntitlementService,
  lockBillingUser,
} from '../../src/billing/entitlement.service';
import { catalogFor } from '../../src/billing/billing.policy';

let h: AcceptanceDatabase;
const service = new EntitlementService();
const launch = new Date('2026-09-15T00:00:00.000Z');
const day = 86_400_000;
let ownerId: string;
beforeAll(async () => {
  h = await acceptanceDatabase();
  ownerId = (
    await h.prisma.user.create({
      data: {
        email: 'Leo.Ezra.Shayne@gmail.com',
        displayName: 'Synthetic launch owner',
      },
    })
  ).id;
});
afterAll(async () => {
  await h?.stop();
});
const membership = (at: Date) =>
  h.prisma.$transaction(async (db) => {
    await lockBillingUser(db, ownerId);
    return service.membership(db, ownerId, at);
  });

test('absent launch does not start offer or gift, and keeps sales closed', async () => {
  expect(catalogFor(null, 'JP', launch)).toMatchObject({
    salesEnabled: false,
    launchAt: null,
    launchEndsAt: null,
    products: [
      { currency: 'USD', amount: 99, launchPrice: false },
      { currency: 'USD', amount: 9900, launchPrice: false },
    ],
  });
  expect(await membership(launch)).toEqual({
    isMember: false,
    expiresAt: null,
  });
  expect(await h.prisma.entitlementGrant.count()).toBe(0);
});

test('future configured launch cannot grant early access or launch discount', async () => {
  const config = await h.prisma.billingConfig.create({
    data: {
      id: 'default',
      launchAt: launch,
      enforcementAt: launch,
      salesEnabled: true,
      enforcementEnabled: true,
    },
  });
  const before = new Date(launch.getTime() - 1);
  expect(catalogFor(config, 'GLOBAL', before).products[1]).toMatchObject({
    amount: 9900,
    launchPrice: false,
  });
  expect((await membership(before)).isMember).toBe(false);
  expect(await h.prisma.entitlementGrant.count()).toBe(0);
});

test('exact launch gifts once under parallel member reads, with exclusive 365-day expiry', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => membership(launch)),
  );
  const end = new Date(launch.getTime() + 365 * day);
  expect(
    results.every(
      (r) => r.isMember && r.expiresAt?.getTime() === end.getTime(),
    ),
  ).toBe(true);
  expect(await h.prisma.entitlementGrant.count()).toBe(1);
  expect((await membership(new Date(end.getTime() - 1))).isMember).toBe(true);
  expect((await membership(end)).isMember).toBe(false);
  expect(await h.prisma.paymentOrder.count()).toBe(0);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: ownerId } })).role,
  ).toBe('USER');
});

test('sales shutdown or later config timestamp cannot extend an already issued gift', async () => {
  const original = await h.prisma.entitlementGrant.findFirstOrThrow();
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: {
      launchAt: new Date(launch.getTime() + day),
      salesEnabled: false,
    },
  });
  expect(
    (await membership(new Date(launch.getTime() + 2 * day))).isMember,
  ).toBe(true);
  const after = await h.prisma.entitlementGrant.findFirstOrThrow();
  expect(after).toEqual(original);
  expect(await h.prisma.entitlementGrant.count()).toBe(1);
});
