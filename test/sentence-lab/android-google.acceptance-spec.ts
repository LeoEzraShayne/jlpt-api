import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AndroidCommerceController } from '../../src/android-commerce/android-commerce.controller';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  GoogleGateway,
  playOrder,
  type PlayOrder,
  type PlayPurchase,
} from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import { GoogleNotificationsService } from '../../src/android-commerce/google-notifications.service';
import {
  moneyMinor,
  timestampNanos,
} from '../../src/android-commerce/google-money';
let h: AcceptanceDatabase;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => jest.restoreAllMocks());
async function fixture() {
  const config = new ConfigService({
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    BILLING_ENVIRONMENT: 'test',
    DATABASE_URL: h.connectionString,
    GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GOOGLE_RTDN_SUBSCRIPTION: 'projects/fixture/subscriptions/rtdn',
  });
  const policy = new AndroidPolicy(config),
    gateway = new GoogleGateway(policy),
    grants = new EntitlementService(config);
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
      displayName: 'Play fixture',
      googlePlayAccountId: randomBytes(32).toString('base64url'),
    },
  });
  const token = randomBytes(32).toString('base64url'),
    googleOrderId = `GPA.${randomUUID()}`;
  const purchase: PlayPurchase = {
    productLineItem: [
      {
        productId: 'jlpt_year_pass',
        productOfferDetails: {
          quantity: 1,
          purchaseOptionId: 'buy',
          offerId: 'launch-64',
          consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
        },
      },
    ],
    purchaseStateContext: { purchaseState: 'PURCHASED' },
    testPurchaseContext: { fopType: 'TEST' },
    orderId: googleOrderId,
    obfuscatedExternalAccountId: user.googlePlayAccountId!,
    purchaseCompletionTime: new Date().toISOString(),
    regionCode: 'JP',
  };
  const order: PlayOrder = {
    orderId: googleOrderId,
    purchaseToken: token,
    state: 'PROCESSED',
    lastEventTime: '2026-09-13T00:00:00.123456789Z',
    createTime: new Date().toISOString(),
    total: { currencyCode: 'JPY', units: '9600', nanos: 0 },
    lineItems: [{ productId: 'jlpt_year_pass' }],
  };
  const getPurchase = jest
    .spyOn(gateway, 'purchase')
    .mockImplementation(() => Promise.resolve(structuredClone(purchase)));
  const getOrder = jest
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
    purchase,
    order,
    getPurchase,
    getOrder,
    consume,
  };
}
test('durable token encryption, confirmed local currency, duplicate/restart processing and consumption', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  expect(row.tokenCiphertext).not.toContain(f.token);
  expect(f.gateway.decrypt(row.tokenCiphertext)).toBe(f.token);
  const restarted = new GooglePurchaseService(
    h.prisma as PrismaService,
    f.policy,
    f.gateway,
    f.grants,
  );
  await Promise.all([restarted.reconcile(row.id), f.service.reconcile(row.id)]);
  await f.service.enqueue(f.token);
  await restarted.reconcile(row.id);
  const done = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
    where: { id: row.id },
  });
  expect(done).toMatchObject({
    userId: f.user.id,
    state: 'VERIFIED',
    consumeState: 'CONSUMED',
    googleLastEventTime: f.order.lastEventTime,
  });
  expect(
    await h.prisma.paymentOrder.findUnique({ where: { id: done.orderId! } }),
  ).toMatchObject({
    currency: 'JPY',
    amount: 9600,
    durationSeconds: 31536000,
    launchPrice: true,
    status: 'PAID',
  });
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(1);
});
test('grant transaction failure never consumes; consume response loss retries without a second grant', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  const grant = jest
    .spyOn(f.grants, 'grantOrder')
    .mockRejectedValueOnce(new Error('commit failed'));
  await f.service.reconcile(row.id);
  expect(f.consume).not.toHaveBeenCalled();
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  grant.mockRestore();
  f.consume.mockRejectedValueOnce(new Error('response lost'));
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(1);
  await f.service.reconcile(row.id);
  expect(f.consume).toHaveBeenCalledTimes(2);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(1);
});
test('pending and unknown owner stay durable without a grant; forged owner cannot move an order', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  f.purchase.purchaseStateContext.purchaseState = 'PENDING';
  delete f.purchase.orderId;
  await f.service.reconcile(row.id);
  expect(f.consume).not.toHaveBeenCalled();
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  f.purchase.purchaseStateContext.purchaseState = 'PURCHASED';
  f.purchase.orderId = f.order.orderId;
  await f.service.reconcile(row.id);
  const stranger = await h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Other',
      googlePlayAccountId: randomBytes(32).toString('base64url'),
    },
  });
  f.purchase.obfuscatedExternalAccountId = stranger.googlePlayAccountId!;
  await f.service.reconcile(row.id);
  expect(
    (
      await h.prisma.googlePlayPurchase.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).userId,
  ).toBe(f.user.id);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: stranger.id } }),
  ).toBe(0);
});
test.each([
  [false, '404'],
  [true, '404'],
  [true, 'incomplete'],
] as const)(
  'verify accepts pending tokens without granting or consuming, then reports cancellation (order present: %s, shape: %s)',
  async (withOrder, shape) => {
    const f = await fixture();
    f.purchase.purchaseStateContext.purchaseState = 'PENDING';
    delete f.purchase.purchaseCompletionTime;
    if (!withOrder) delete f.purchase.orderId;
    f.order.state = 'PENDING';
    if (shape === '404')
      f.getOrder.mockRejectedValue(new Error('GOOGLE_API_404'));
    else
      f.getOrder.mockImplementation(() =>
        Promise.resolve().then(() =>
          playOrder.parse({
            orderId: f.order.orderId,
            purchaseToken: f.token,
            state: 'CANCELED',
            createTime: f.order.createTime,
            lineItems: f.order.lineItems,
            orderHistory: {},
          }),
        ),
      );
    const controller = new AndroidCommerceController(
      h.prisma as PrismaService,
      f.policy,
      null as never,
      f.service,
      null as never,
    );
    jest
      .spyOn(controller, 'entitlements')
      .mockResolvedValue({ data: {} } as never);
    const req = { currentUser: { id: f.user.id } } as Request;
    const input = { productId: 'jlpt_year_pass', purchaseToken: f.token };
    const eventId = randomUUID();
    await f.notifications.record(eventId, 'PURCHASE_HINT', f.token);
    expect((await controller.verify(req, input)).data).toMatchObject({
      status: 'PENDING',
      orderId: null,
      consumption: 'PENDING',
    });
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.getOrder).not.toHaveBeenCalled();
    expect(
      await h.prisma.billingEvent.findFirst({ where: { eventId } }),
    ).toMatchObject({ status: 'RECEIVED' });
    expect(
      await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
    ).toBe(0);
    expect(
      await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
    ).toBe(0);
    f.purchase.purchaseStateContext.purchaseState = 'CANCELLED';
    f.order.state = 'CANCELLED';
    await expect(controller.verify(req, input)).rejects.toMatchObject({
      response: { code: 'GOOGLE_PURCHASE_CANCELLED' },
      status: 409,
    });
    expect(f.consume).not.toHaveBeenCalled();
    expect(f.getOrder).not.toHaveBeenCalled();
    expect(
      await h.prisma.billingEvent.findFirst({ where: { eventId } }),
    ).toMatchObject({ status: 'PROCESSED', errorCode: null });
    expect(
      await h.prisma.paymentOrder.count({ where: { userId: f.user.id } }),
    ).toBe(0);
    expect(
      await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
    ).toBe(0);
  },
);
test('refund before owner persists a tombstone and later purchased snapshots never create a grant', async () => {
  const f = await fixture();
  delete f.purchase.obfuscatedExternalAccountId;
  f.order.state = 'REFUNDED';
  const row = await f.service.enqueue(f.token);
  await f.service.reconcile(row.id);
  expect(
    (
      await h.prisma.googlePlayPurchase.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).state,
  ).toBe('REFUNDED');
  f.purchase.obfuscatedExternalAccountId = f.user.googlePlayAccountId!;
  f.order.state = 'PROCESSED';
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(f.consume).not.toHaveBeenCalled();
  expect(
    await h.prisma.paymentOrder.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ status: 'REFUNDED', refundedAmount: 9600 });
});
test('refund totals are cumulative snapshots, pending refunds excluded and old nanosecond revisions ignored', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  await f.service.reconcile(row.id);
  f.order.lastEventTime = '2026-09-13T00:00:00.123456790Z';
  f.order.state = 'PARTIALLY_REFUNDED';
  f.order.orderHistory = {
    partialRefundEvents: [
      {
        state: 'PROCESSED_SUCCESSFULLY',
        refundDetails: {
          total: { currencyCode: 'JPY', units: '1000', nanos: 0 },
        },
      },
      {
        state: 'PENDING',
        refundDetails: {
          total: { currencyCode: 'JPY', units: '2000', nanos: 0 },
        },
      },
    ],
  };
  await f.service.reconcile(row.id);
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.paymentOrder.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ refundedAmount: 1000, status: 'PARTIALLY_REFUNDED' });
  f.order.lastEventTime = '2026-09-13T00:00:00.123456789Z';
  delete f.order.orderHistory;
  f.order.state = 'PROCESSED';
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.paymentOrder.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ refundedAmount: 1000 });
  f.order.lastEventTime = '2026-09-13T00:00:01Z';
  f.order.state = 'REFUNDED';
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.entitlementGrant.findFirst({ where: { userId: f.user.id } }),
  ).toMatchObject({ status: 'REVOKED' });
});
test('notification during a worker lease fences the stale grant; a replacement worker finishes new work', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.getPurchase.mockImplementationOnce(async () => {
    entered();
    await wait;
    return structuredClone(f.purchase);
  });
  const processing = f.service.reconcile(row.id);
  await started;
  await f.service.enqueue(f.token);
  release();
  await processing;
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(f.consume).not.toHaveBeenCalled();
  await h.prisma.googlePlayPurchase.update({
    where: { id: row.id },
    data: { leaseUntil: new Date(0) },
  });
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(1);
});
test('RTDN before owner is committed with encrypted queue and duplicate messages share one revision', async () => {
  const f = await fixture();
  jest.spyOn(f.gateway, 'verifyPush').mockResolvedValue();
  const body = {
    subscription: 'projects/fixture/subscriptions/rtdn',
    message: {
      messageId: randomUUID(),
      data: Buffer.from(
        JSON.stringify({
          packageName: f.policy.packageName,
          eventTimeMillis: String(Date.now()),
          oneTimeProductNotification: {
            notificationType: 1,
            purchaseToken: f.token,
            sku: 'jlpt_year_pass',
          },
        }),
      ).toString('base64'),
    },
  };
  await Promise.all([
    f.notifications.receive('fixture', body),
    f.notifications.receive('fixture', body),
  ]);
  const event = await h.prisma.billingEvent.findFirstOrThrow({
    where: { eventId: `${body.subscription}:${body.message.messageId}` },
  });
  expect(event.googlePurchaseId).toBeTruthy();
  expect(JSON.stringify(event.payload)).not.toContain(f.token);
  expect(
    await h.prisma.googlePlayPurchase.findUnique({
      where: { id: event.googlePurchaseId! },
    }),
  ).toMatchObject({ userId: null, revision: 1 });
});
test('a failed later voided page never advances watermark; restart replays the whole interval idempotently', async () => {
  const f = await fixture();
  f.config.set('GOOGLE_PLAY_CREDENTIALS_FILE', 'fixture-not-read');
  const id = `google-voided:${f.policy.packageName}:test`;
  const before = new Date(Date.now() - 86400_000);
  await h.prisma.androidCommerceSyncState.upsert({
    where: { id },
    create: { id, watermarkAt: before },
    update: { watermarkAt: before },
  });
  const scan = jest
    .spyOn(f.gateway, 'voided')
    .mockResolvedValueOnce({
      voidedPurchases: [{ purchaseToken: f.token, voidedTimeMillis: '1' }],
      tokenPagination: { nextPageToken: 'two' },
    })
    .mockRejectedValueOnce(new Error('page failed'));
  await f.notifications.syncVoided();
  expect(
    (
      await h.prisma.androidCommerceSyncState.findUniqueOrThrow({
        where: { id },
      })
    ).watermarkAt,
  ).toEqual(before);
  scan.mockResolvedValue({
    voidedPurchases: [{ purchaseToken: f.token, voidedTimeMillis: '1' }],
  });
  await f.notifications.syncVoided();
  expect(
    (
      await h.prisma.androidCommerceSyncState.findUniqueOrThrow({
        where: { id },
      })
    ).watermarkAt!.getTime(),
  ).toBeGreaterThan(before.getTime());
  expect(
    (
      await h.prisma.googlePlayPurchase.findFirstOrThrow({
        where: {
          tokenHash: createHash('sha256').update(f.token).digest('hex'),
        },
      })
    ).revision,
  ).toBe(1);
});
test('precise currency conversion rejects unsupported precision and preserves Google submillisecond ordering', () => {
  expect(moneyMinor({ currencyCode: 'USD', units: '64', nanos: 0 })).toBe(6400);
  expect(moneyMinor({ currencyCode: 'JPY', units: '9600', nanos: 0 })).toBe(
    9600,
  );
  expect(() =>
    moneyMinor({ currencyCode: 'JPY', units: '1', nanos: 1000000 }),
  ).toThrow();
  expect(
    timestampNanos('2026-09-13T00:00:00.123456790Z') -
      timestampNanos('2026-09-13T00:00:00.123456789Z'),
  ).toBe(1n);
});

test('wrong provider environment, order token and unsupported offer cannot mint membership', async () => {
  const f = await fixture();
  const row = await f.service.enqueue(f.token);
  delete f.purchase.testPurchaseContext;
  await f.service.reconcile(row.id);
  f.purchase.testPurchaseContext = { fopType: 'TEST' };
  f.order.purchaseToken = 'another-token';
  await f.service.reconcile(row.id);
  f.order.purchaseToken = f.token;
  f.purchase.productLineItem[0].productOfferDetails!.offerId = 'forged-offer';
  await f.service.reconcile(row.id);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(f.consume).not.toHaveBeenCalled();
  expect(
    (
      await h.prisma.googlePlayPurchase.findUniqueOrThrow({
        where: { id: row.id },
      })
    ).errorCode,
  ).toBe('GOOGLE_RECONCILIATION_FAILED');
});
