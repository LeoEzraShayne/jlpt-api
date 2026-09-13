import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { activateWebBilling } from '../../scripts/billing/activation';
import { EntitlementService } from '../../src/billing/entitlement.service';
import type { PrismaService } from '../../src/database/prisma.service';
import { validateEnv } from '../../src/config/env';

const migration = '202609130003_android_commerce';
const launch = new Date('2026-09-12T23:58:15.676Z');
let h: AcceptanceDatabase;
let ownerId: string;
beforeAll(async () => {
  h = await acceptanceDatabase({ stopBeforeMigration: migration });
});
afterAll(async () => {
  await h?.stop();
});
async function snapshot(tables: string[]) {
  const result: Record<string, unknown> = {};
  for (const name of tables) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
      throw Error('UNEXPECTED_TABLE_NAME');
    result[name] = (
      await h.sql.query<{ rows: unknown }>(
        `SELECT COALESCE(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) AS rows FROM (SELECT to_jsonb(t) - 'googlePlayAccountId' - 'androidSalesEnabled' - 'androidRewardsEnabled' - 'googlePurchaseId' AS row FROM "${name}" t) s`,
      )
    ).rows[0].rows;
  }
  return result;
}

// Raw pg Date serialization follows the host timezone; TIMESTAMP(3) stores UTC wall time.
const seed = (query: string, values: unknown[]) =>
  h.sql.query(
    query,
    values.map((value) =>
      value instanceof Date ? value.toISOString() : value,
    ),
  );

test('Android migration preserves all previous tables and live Web billing data; native flags default false', async () => {
  ownerId = randomUUID();
  await seed(
    'INSERT INTO "User" (id,email,"displayName","updatedAt") VALUES ($1,$2,$3,$4)',
    [ownerId, 'leo.ezra.shayne@gmail.com', 'Synthetic W3 owner', launch],
  );
  await seed(
    'INSERT INTO "AuthSession" (id,"userId","tokenHash","expiresAt") VALUES ($1,$2,$3,$4)',
    [
      randomUUID(),
      ownerId,
      randomUUID(),
      new Date(launch.getTime() + 86_400_000),
    ],
  );
  await seed(
    'INSERT INTO "BillingConfig" (id,"launchAt","enforcementAt","salesEnabled","enforcementEnabled","rewardsEnabled","updatedAt") VALUES ($1,$2,$2,true,true,false,$2)',
    ['default', launch],
  );
  await seed(
    'INSERT INTO "PaymentOrder" (id,"userId",provider,environment,"productCode",market,currency,amount,"durationSeconds","requestKey",snapshot,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
    [
      'legacy-paid',
      ownerId,
      'STRIPE',
      'live',
      'DAY_PASS',
      'JP',
      'JPY',
      100,
      86400,
      randomUUID(),
      JSON.stringify({ historicalPrice: true }),
      launch,
    ],
  );
  await seed(
    'INSERT INTO "EntitlementGrant" (id,"userId",source,"sourceKey","startsAt","endsAt","durationSeconds","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$5)',
    [
      'launch-gift',
      ownerId,
      'LAUNCH_GIFT',
      'launch-vip:leo.ezra.shayne@gmail.com',
      launch,
      new Date(launch.getTime() + 365 * 86400_000),
      365 * 86400,
    ],
  );
  await seed('UPDATE "PaymentOrder" SET status=$1,"paidAt"=$2 WHERE id=$3', [
    'PAID',
    launch,
    'legacy-paid',
  ]);
  await seed(
    'INSERT INTO "BillingEvent" (id,provider,environment,"eventId","eventType",payload,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      'prior-event',
      'STRIPE',
      'live',
      'prior-event',
      'checkout.session.completed',
      JSON.stringify({ original: true }),
      launch,
    ],
  );
  const tables = (
    await h.sql.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows.map((r) => r.tablename);
  const before = await snapshot(tables);
  await h.sql.query(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  );
  expect(await snapshot(tables)).toEqual(before);
  expect(
    await h.prisma.billingConfig.findUniqueOrThrow({
      where: { id: 'default' },
    }),
  ).toMatchObject({
    salesEnabled: true,
    enforcementEnabled: true,
    rewardsEnabled: false,
    launchAt: launch,
    enforcementAt: launch,
    androidSalesEnabled: false,
    androidRewardsEnabled: false,
  });
  const allTables = (
    await h.sql.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname='public'",
    )
  ).rows.map((r) => r.tablename);
  expect(allTables.filter((name) => !tables.includes(name)).sort()).toEqual(
    [
      'AndroidBindingRequest',
      'AndroidCommerceSyncState',
      'AndroidSession',
      'GooglePlayPurchase',
      'RewardTicket',
    ].sort(),
  );
});

test('repeating real Web activation after migration preserves native shutdown and launch gift', async () => {
  const before = await h.prisma.entitlementGrant.findMany();
  const result = await activateWebBilling(
    h.prisma as PrismaService,
    new EntitlementService(new ConfigService({ BILLING_ENVIRONMENT: 'live' })),
    new Date(launch.getTime() + 3600_000),
  );
  expect(result).toMatchObject({
    launchAt: launch,
    enforcementAt: launch,
    alreadyActivated: true,
  });
  expect(await h.prisma.entitlementGrant.findMany()).toEqual(before);
  expect(
    await h.prisma.billingConfig.findUniqueOrThrow({
      where: { id: 'default' },
    }),
  ).toMatchObject({
    androidSalesEnabled: false,
    androidRewardsEnabled: false,
    salesEnabled: true,
  });
});

test('unowned pending tokens persist once across environments and multiple events can reference their queue', async () => {
  const tokenHash = randomUUID();
  const purchase = await h.prisma.googlePlayPurchase.create({
    data: {
      packageName: 'com.meritledger.app',
      environment: 'live',
      tokenHash,
      tokenCiphertext: 'synthetic-AEAD-envelope-not-a-real-token',
    },
  });
  expect(purchase).toMatchObject({
    userId: null,
    productId: null,
    orderId: null,
    state: 'RECEIVED',
    revision: 0,
  });
  await expect(
    h.prisma.googlePlayPurchase.create({
      data: {
        packageName: purchase.packageName,
        environment: 'test',
        tokenHash,
        tokenCiphertext: 'synthetic',
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await h.prisma.billingEvent.createMany({
    data: ['purchased', 'refunded'].map((eventId) => ({
      provider: 'GOOGLE',
      environment: 'live',
      eventId,
      eventType: eventId,
      googlePurchaseId: purchase.id,
      payload: { tokenHash },
    })),
  });
  expect(
    await h.prisma.billingEvent.count({
      where: { googlePurchaseId: purchase.id },
    }),
  ).toBe(2);
  expect(await h.prisma.paymentOrder.count()).toBe(1);
  expect(await h.prisma.entitlementGrant.count()).toBe(1);
});

test('multiple reward tickets coexist while request keys stay unique and no reward is granted by storage', async () => {
  const base = {
    userId: ownerId,
    environment: 'live',
    ssvUserId: randomUUID(),
    adUnitId: 'synthetic-sdk-unit',
    ssvAdUnitId: '1234',
    rewardItem: 'jlpt_task',
    expiresAt: new Date(launch.getTime() + 1200_000),
  };
  const requestKey = randomUUID();
  await h.prisma.rewardTicket.create({
    data: { ...base, requestKey, secretHash: randomUUID() },
  });
  await h.prisma.rewardTicket.create({
    data: { ...base, requestKey: randomUUID(), secretHash: randomUUID() },
  });
  await expect(
    h.prisma.rewardTicket.create({
      data: { ...base, requestKey, secretHash: randomUUID() },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
  expect(await h.prisma.rewardTicket.count()).toBe(2);
  expect(await h.prisma.rewardEvent.count()).toBe(0);
});

test('native feature environment defaults do not require platform credentials or alter live Web settings', () => {
  const env = validateEnv({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/jlpt',
    FRONTEND_URL: 'https://example.test',
    SESSION_SECRET: 'synthetic-session-secret'.repeat(2),
    BILLING_ENVIRONMENT: 'live',
    GOOGLE_CLIENT_ID: 'synthetic',
    GOOGLE_CLIENT_SECRET: 'synthetic',
    GOOGLE_CALLBACK_URL: 'https://example.test/callback',
  });
  expect(env).toMatchObject({
    ANDROID_COMMERCE_ENABLED: false,
    ANDROID_GOOGLE_ENABLED: false,
    ANDROID_ADMOB_ENABLED: false,
    BILLING_ENVIRONMENT: 'live',
  });
});
