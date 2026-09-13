import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  GoogleGateway,
  type PlayPurchase,
  type PlayOrder,
} from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import { GoogleNotificationsService } from '../../src/android-commerce/google-notifications.service';
let h: AcceptanceDatabase;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => {
  jest.restoreAllMocks();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const config = new ConfigService({
    DATABASE_URL: h.connectionString,
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    BILLING_ENVIRONMENT: 'test',
    GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GOOGLE_RTDN_SUBSCRIPTION: 'projects/f/subscriptions/independent',
  });
  const policy = new AndroidPolicy(config);
  const gateway = new GoogleGateway(policy);
  const grants = new EntitlementService(config);
  const service = new GooglePurchaseService(
    h.prisma as PrismaService,
    policy,
    gateway,
    grants,
  );
  const notifications = new GoogleNotificationsService(
    h.prisma as PrismaService,
    policy,
    gateway,
    service,
  );
  const user = await h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'F independent Google',
      googlePlayAccountId: randomBytes(32).toString('base64url'),
    },
  });
  const token = randomBytes(32).toString('base64url');
  const order: PlayOrder = {
    orderId: `GPA.${randomUUID()}`,
    purchaseToken: token,
    state: 'PROCESSED',
    lastEventTime: '2026-09-13T00:00:00.123456789Z',
    createTime: new Date().toISOString(),
    total: { currencyCode: 'USD', units: '0', nanos: 990000000 },
    lineItems: [{ productId: 'jlpt_day_pass' }],
  };
  const purchase: PlayPurchase = {
    orderId: order.orderId,
    testPurchaseContext: { fopType: 'TEST' },
    obfuscatedExternalAccountId: user.googlePlayAccountId!,
    purchaseCompletionTime: new Date().toISOString(),
    purchaseStateContext: { purchaseState: 'PURCHASED' },
    productLineItem: [
      {
        productId: 'jlpt_day_pass',
        productOfferDetails: {
          quantity: 1,
          purchaseOptionId: 'buy',
          consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
        },
      },
    ],
  };
  jest
    .spyOn(gateway, 'purchase')
    .mockImplementation(() => Promise.resolve(structuredClone(purchase)));
  jest
    .spyOn(gateway, 'order')
    .mockImplementation(() => Promise.resolve(structuredClone(order)));
  const consume = jest.spyOn(gateway, 'consume').mockResolvedValue();
  return {
    config,
    policy,
    gateway,
    grants,
    service,
    notifications,
    user,
    token,
    order,
    purchase,
    consume,
  };
}

test('late consume completion from an expired worker cannot revive a replacement worker refund', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  const entered = deferred(),
    release = deferred();
  f.consume.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
  });
  const oldWork = f.service.reconcile(row.id);
  await entered.promise;
  try {
    expect(
      await h.prisma.entitlementGrant.count({
        where: { userId: f.user.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    await h.prisma.googlePlayPurchase.update({
      where: { id: row.id },
      data: { leaseUntil: new Date(0) },
    });
    await f.notifications.record(
      `f-refund:${randomUUID()}`,
      'VOIDED_HINT',
      f.token,
    );
    f.order.state = 'REFUNDED';
    f.order.lastEventTime = '2026-09-13T00:00:00.123456790Z';
    const replacement = new GooglePurchaseService(
      h.prisma as PrismaService,
      f.policy,
      f.gateway,
      f.grants,
    );
    await replacement.reconcile(row.id);
  } finally {
    release.resolve();
    await oldWork;
  }
  const final = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(final).toMatchObject({
    state: 'REFUNDED',
    consumeState: 'NOT_APPLICABLE',
    leaseToken: null,
  });
  expect(
    await h.prisma.paymentOrder.findUnique({ where: { id: final.orderId! } }),
  ).toMatchObject({ status: 'REFUNDED', amount: 99, refundedAmount: 99 });
  expect(
    await h.prisma.entitlementGrant.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ status: 'REVOKED' });
});

test('lease expiry inside the grant transaction rolls back all order and grant writes', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  const original = f.grants.grantOrder.bind(f.grants);
  jest
    .spyOn(f.grants, 'grantOrder')
    .mockImplementationOnce(async (tx, orderId, paidAt) => {
      const grant = await original(tx, orderId, paidAt);
      // Deterministic lease-clock boundary in the same real transaction; no provider or billing writes mocked.
      await tx.googlePlayPurchase.update({
        where: { id: row.id },
        data: { leaseUntil: new Date(0) },
      });
      return grant;
    });
  await f.service.reconcile(row.id);
  const after = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(after.orderId).toBeNull();
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(f.consume).not.toHaveBeenCalled();
  await h.prisma.googlePlayPurchase.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(0) },
  });
  await f.service.enqueue(f.token);
  await f.service.reconcile(row.id);
  const recovered = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(recovered.orderId).not.toBeNull();
  expect(recovered.consumeState).toBe('CONSUMED');
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
  ).toBe(1);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(1);
});

test('durable RTDN receipt and encrypted token queue are atomic when encryption fails', async () => {
  const f = await fixture();
  const eventId = `f-atomic:${randomUUID()}`;
  const before = await h.prisma.googlePlayPurchase.count();
  f.config.set('GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY', 'missing');
  await expect(
    f.notifications.record(eventId, 'PURCHASE_HINT', f.token),
  ).rejects.toBeDefined();
  expect(await h.prisma.billingEvent.count({ where: { eventId } })).toBe(0);
  expect(await h.prisma.googlePlayPurchase.count()).toBe(before);
  f.config.set(
    'GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY',
    randomBytes(32).toString('hex'),
  );
  await f.notifications.record(eventId, 'PURCHASE_HINT', f.token);
  const event = await h.prisma.billingEvent.findFirstOrThrow({
    where: { eventId },
  });
  const queue = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
    where: { id: event.googlePurchaseId! },
  });
  expect(queue.userId).toBeNull();
  expect(queue.productId).toBeNull();
  expect(f.gateway.decrypt(queue.tokenCiphertext)).toBe(f.token);
  expect(JSON.stringify(event)).not.toContain(f.token);
});

test('multiple fractional-currency refund snapshots do not compound and full refund is terminal', async () => {
  const f = await fixture(),
    row = await f.service.enqueue(f.token);
  await f.service.reconcile(row.id);
  f.order.state = 'PARTIALLY_REFUNDED';
  f.order.lastEventTime = '2026-09-13T00:00:01Z';
  f.order.orderHistory = {
    partialRefundEvents: [
      {
        state: 'PROCESSED_SUCCESSFULLY',
        refundDetails: {
          total: { currencyCode: 'USD', units: '0', nanos: 100000000 },
        },
      },
      {
        state: 'PROCESSED_SUCCESSFULLY',
        refundDetails: {
          total: { currencyCode: 'USD', units: '0', nanos: 250000000 },
        },
      },
      {
        state: 'PENDING',
        refundDetails: {
          total: { currencyCode: 'USD', units: '0', nanos: 500000000 },
        },
      },
    ],
  };
  for (let i = 0; i < 2; i++) await f.service.reconcile(row.id);
  expect(
    await h.prisma.paymentOrder.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({
    amount: 99,
    refundedAmount: 35,
    status: 'PARTIALLY_REFUNDED',
  });
  f.order.state = 'REFUNDED';
  f.order.lastEventTime = '2026-09-13T00:00:02Z';
  await f.service.reconcile(row.id);
  f.order.state = 'PROCESSED';
  f.order.lastEventTime = '2026-09-13T00:00:03Z';
  delete f.order.orderHistory;
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.paymentOrder.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ status: 'REFUNDED', refundedAmount: 99 });
  expect(
    await h.prisma.entitlementGrant.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ status: 'REVOKED' });
});

test('a stale voided scan cannot overwrite a replacement lease watermark', async () => {
  const f = await fixture();
  f.config.set('GOOGLE_PLAY_CREDENTIALS_FILE', 'synthetic-never-read');
  const id = `google-voided:${f.policy.packageName}:test`,
    initial = new Date(Date.now() - 3600000);
  await h.prisma.androidCommerceSyncState.upsert({
    where: { id },
    create: { id, watermarkAt: initial },
    update: { watermarkAt: initial },
  });
  const entered = deferred(),
    release = deferred();
  jest.spyOn(f.gateway, 'voided').mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return { voidedPurchases: [] };
  });
  const work = f.notifications.syncVoided();
  await entered.promise;
  const replacement = new Date(Date.now() - 1000),
    token = randomUUID();
  try {
    await h.prisma.androidCommerceSyncState.update({
      where: { id },
      data: {
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 60000),
        watermarkAt: replacement,
      },
    });
  } finally {
    release.resolve();
    await work;
  }
  expect(
    await h.prisma.androidCommerceSyncState.findUnique({ where: { id } }),
  ).toMatchObject({ leaseToken: token, watermarkAt: replacement });
});
