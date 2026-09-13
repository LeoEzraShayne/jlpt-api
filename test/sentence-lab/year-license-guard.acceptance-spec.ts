import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  GoogleGateway,
  type PlayOrder,
  type PlayPurchase,
} from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import { guardYearPurchase, type YearManifest } from './year-license-guard';
import { acceptanceDatabase } from './database';

function fixture() {
  const token = randomBytes(48).toString('base64url');
  const manifest: YearManifest = {
    schemaVersion: 1,
    runId: randomUUID(),
    createdAt: '2026-09-13T08:00:00.000Z',
    expiresAt: '2026-09-13T10:00:00.000Z',
    packageName: 'com.meritledger.app',
    productId: 'jlpt_year_pass',
    purchaseOptionId: 'buy',
    offerId: 'launch-64',
    currency: 'JPY',
    priceAmountMicros: 9824000000,
    obfuscatedAccountId: randomUUID(),
  };
  const purchase: PlayPurchase = {
    testPurchaseContext: { fopType: 'TEST' },
    obfuscatedExternalAccountId: manifest.obfuscatedAccountId,
    purchaseStateContext: { purchaseState: 'PURCHASED' },
    purchaseCompletionTime: '2026-09-13T08:01:02.345Z',
    orderId: `GPA.${randomUUID()}`,
    regionCode: 'JP',
    productLineItem: [
      {
        productId: 'jlpt_year_pass',
        productOfferDetails: {
          purchaseOptionId: 'buy',
          offerId: 'launch-64',
          quantity: 1,
          consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
        },
      },
    ],
  };
  const order: PlayOrder = {
    orderId: purchase.orderId!,
    purchaseToken: token,
    state: 'PROCESSED',
    createTime: purchase.purchaseCompletionTime!,
    lastEventTime: purchase.purchaseCompletionTime!,
    total: { currencyCode: 'JPY', units: '9824', nanos: 0 },
    lineItems: [{ productId: 'jlpt_year_pass' }],
  };
  return { manifest, token, purchase, order };
}

test.each([
  'live',
  'wrong-owner',
  'day',
  'standard-offer',
  'quantity',
  'country',
  'price',
  'currency',
  'order-token',
  'order-id',
  'pending',
  'old-completion',
  'missing-completion',
] as const)('rejects %s before any provider consume or refund', (change) => {
  const f = fixture();
  switch (change) {
    case 'live':
      delete f.purchase.testPurchaseContext;
      break;
    case 'wrong-owner':
      f.purchase.obfuscatedExternalAccountId = randomUUID();
      break;
    case 'day':
      f.purchase.productLineItem[0].productId = 'jlpt_day_pass';
      break;
    case 'standard-offer':
      delete f.purchase.productLineItem[0].productOfferDetails!.offerId;
      break;
    case 'quantity':
      f.purchase.productLineItem[0].productOfferDetails!.quantity = 2;
      break;
    case 'country':
      f.purchase.regionCode = 'US';
      break;
    case 'price':
      f.order.total.units = '15200';
      break;
    case 'currency':
      f.order.total.currencyCode = 'USD';
      break;
    case 'order-token':
      f.order.purchaseToken = 'different-token';
      break;
    case 'order-id':
      f.order.orderId = 'another-order';
      break;
    case 'pending':
      f.purchase.purchaseStateContext.purchaseState = 'PENDING';
      break;
    case 'old-completion':
      f.purchase.purchaseCompletionTime = '2026-09-12T08:01:02Z';
      break;
    case 'missing-completion':
      delete f.purchase.purchaseCompletionTime;
      break;
  }
  expect(() =>
    guardYearPurchase(f.manifest, f.token, f.purchase, f.order, 'paid'),
  ).toThrow();
});

test('a different valid year test order cannot replace an inspected target', () => {
  const f = fixture();
  const pin = guardYearPurchase(
    f.manifest,
    f.token,
    f.purchase,
    f.order,
    'paid',
  );
  f.purchase.orderId = f.order.orderId = `GPA.${randomUUID()}`;
  expect(() =>
    guardYearPurchase(f.manifest, f.token, f.purchase, f.order, 'paid', pin),
  ).toThrow('PINNED_PURCHASE_REQUIRED');
});

test('strictly guarded year test evidence uses the actual PG verify/consume/refund path without extending a replay', async () => {
  const h = await acceptanceDatabase();
  try {
    const f = fixture();
    const config = new ConfigService({
      DATABASE_URL: h.connectionString,
      BILLING_ENVIRONMENT: 'test',
      ANDROID_COMMERCE_ENVIRONMENT: 'test',
      GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    });
    const policy = new AndroidPolicy(config),
      gateway = new GoogleGateway(policy);
    const user = await h.prisma.user.create({
      data: {
        email: `${f.manifest.runId}@example.test`,
        displayName: 'Isolated year guard',
        googlePlayAccountId: f.manifest.obfuscatedAccountId,
      },
    });
    const pin = guardYearPurchase(
      f.manifest,
      f.token,
      f.purchase,
      f.order,
      'paid',
    );
    let mode: 'paid' | 'refunded' = 'paid';
    jest.spyOn(gateway, 'purchase').mockImplementation(() => {
      guardYearPurchase(f.manifest, f.token, f.purchase, f.order, mode, pin);
      return Promise.resolve(structuredClone(f.purchase));
    });
    jest
      .spyOn(gateway, 'order')
      .mockImplementation(() => Promise.resolve(structuredClone(f.order)));
    const consume = jest.spyOn(gateway, 'consume').mockImplementation(() => {
      guardYearPurchase(f.manifest, f.token, f.purchase, f.order, 'paid', pin);
      f.purchase.productLineItem[0].productOfferDetails!.consumptionState =
        'CONSUMPTION_STATE_CONSUMED';
      return Promise.resolve();
    });
    const service = new GooglePurchaseService(
      h.prisma as PrismaService,
      policy,
      gateway,
      new EntitlementService(config),
    );
    const row = await service.enqueue(f.token);
    await service.reconcile(row.id);
    const before = await h.prisma.entitlementGrant.findFirstOrThrow();
    await service.enqueue(f.token);
    await service.reconcile(row.id);
    expect(await h.prisma.entitlementGrant.findMany()).toEqual([before]);
    expect(before.endsAt.getTime() - before.startsAt.getTime()).toBe(
      31536000000,
    );
    expect(before.startsAt.toISOString()).toBe(
      f.purchase.purchaseCompletionTime,
    );
    expect(consume).toHaveBeenCalledTimes(1);
    expect(await h.prisma.paymentOrder.findFirstOrThrow()).toMatchObject({
      userId: user.id,
      providerOrderId: `google:test:${pin.googleOrderId}`,
      amount: 9824,
      currency: 'JPY',
      durationSeconds: 31536000,
      status: 'PAID',
      launchPrice: true,
    });
    f.purchase.purchaseStateContext.purchaseState = 'CANCELLED';
    delete f.purchase.orderId;
    f.order.state = 'REFUNDED';
    f.order.lastEventTime = '2026-09-13T08:02:00.000Z';
    mode = 'refunded';
    for (let i = 0; i < 2; i++) {
      await service.enqueue(f.token);
      await service.reconcile(row.id);
    }
    expect(await h.prisma.paymentOrder.count()).toBe(1);
    expect(await h.prisma.entitlementGrant.count()).toBe(1);
    expect(await h.prisma.paymentOrder.findFirstOrThrow()).toMatchObject({
      status: 'REFUNDED',
      refundedAmount: 9824,
    });
    expect(await h.prisma.entitlementGrant.findFirstOrThrow()).toMatchObject({
      status: 'REVOKED',
      startsAt: before.startsAt,
      endsAt: before.endsAt,
    });
    expect(consume).toHaveBeenCalledTimes(1);
  } finally {
    jest.restoreAllMocks();
    await h.stop();
  }
});
