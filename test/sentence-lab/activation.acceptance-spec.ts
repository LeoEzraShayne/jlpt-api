import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { activateWebBilling } from '../../scripts/billing/activation';
import type { PrismaService } from '../../src/database/prisma.service';

let h: AcceptanceDatabase;
const now = new Date('2026-09-15T01:02:03.456Z');
const day = 86_400_000;
const service = new EntitlementService(
  new ConfigService({ BILLING_ENVIRONMENT: 'live' }),
);
const activate = (at = now) =>
  activateWebBilling(h.prisma as PrismaService, service, at);
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
beforeEach(async () => {
  await h.prisma.entitlementGrant.deleteMany();
  await h.prisma.user.deleteMany();
  await h.prisma.billingConfig.deleteMany();
});
const owner = () =>
  h.prisma.user.create({
    data: {
      email: 'leo.ezra.shayne@gmail.com',
      displayName: 'Synthetic designated owner',
    },
  });

test('eight first activations serialize one start, one 365-day gift, and a shared 90-day offer', async () => {
  const u = await owner();
  const settled = await Promise.allSettled(
    Array.from({ length: 8 }, () => activate()),
  );
  expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(
    0,
  );
  const outputs = settled.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  expect(outputs.filter((r) => !r.alreadyActivated)).toHaveLength(1);
  for (const result of outputs)
    expect(result).toMatchObject({
      launchAt: now,
      enforcementAt: now,
      launchEndsAt: new Date(now.getTime() + 90 * day),
      giftStartsAt: now,
      giftEndsAt: new Date(now.getTime() + 365 * day),
      salesEnabled: true,
      enforcementEnabled: true,
      rewardsEnabled: false,
    });
  expect(await h.prisma.entitlementGrant.count()).toBe(1);
  expect(await h.prisma.paymentOrder.count()).toBe(0);
  expect(
    (await h.prisma.user.findUniqueOrThrow({ where: { id: u.id } })).role,
  ).toBe('USER');
});

test('later repeat retains original timestamps and gift even after sales were closed', async () => {
  await owner();
  await activate();
  const original = await h.prisma.entitlementGrant.findFirstOrThrow();
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { salesEnabled: false },
  });
  const again = await activate(new Date(now.getTime() + 20 * day));
  expect(again).toMatchObject({
    alreadyActivated: true,
    launchAt: now,
    enforcementAt: now,
    salesEnabled: true,
  });
  expect(await h.prisma.entitlementGrant.findFirstOrThrow()).toEqual(original);
});

test('missing designated account rolls back even a newly inserted singleton', async () => {
  await expect(activate()).rejects.toThrow('Designated gift account');
  expect(await h.prisma.billingConfig.count()).toBe(0);
  expect(await h.prisma.entitlementGrant.count()).toBe(0);
});

test.each([
  { launchAt: new Date(now.getTime() + day), enforcementAt: null },
  { launchAt: null, enforcementAt: now },
  { launchAt: now, enforcementAt: new Date(now.getTime() + day) },
])(
  'future or inconsistent timestamps stop activation without mutation: %j',
  async (timestamps) => {
    await owner();
    const before = await h.prisma.billingConfig.create({
      data: { id: 'default', ...timestamps },
    });
    await expect(activate()).rejects.toThrow();
    expect(
      await h.prisma.billingConfig.findUniqueOrThrow({
        where: { id: 'default' },
      }),
    ).toEqual(before);
    expect(await h.prisma.entitlementGrant.count()).toBe(0);
  },
);

test('conflicting existing gift rolls back launch and sales instead of rewriting the gift', async () => {
  const u = await owner();
  const original = await h.prisma.entitlementGrant.create({
    data: {
      userId: u.id,
      source: 'LAUNCH_GIFT',
      sourceKey: 'launch-vip:leo.ezra.shayne@gmail.com',
      startsAt: new Date(now.getTime() - day),
      endsAt: new Date(now.getTime() + 364 * day),
      durationSeconds: 365 * 86400,
    },
  });
  await expect(activate()).rejects.toThrow('Gift conflicts');
  expect(await h.prisma.billingConfig.count()).toBe(0);
  expect(await h.prisma.entitlementGrant.findFirstOrThrow()).toEqual(original);
});
