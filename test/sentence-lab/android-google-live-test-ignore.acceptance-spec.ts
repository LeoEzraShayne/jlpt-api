import {
  createHash,
  randomBytes,
  randomUUID,
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AndroidCommerceController } from '../../src/android-commerce/android-commerce.controller';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  GoogleGateway,
  type PlayPurchase,
} from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import { GoogleNotificationsService } from '../../src/android-commerce/google-notifications.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
let h: AcceptanceDatabase;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => jest.restoreAllMocks());
function fixture(environment = 'live') {
  const config = new ConfigService({
    ANDROID_COMMERCE_ENVIRONMENT: environment,
    BILLING_ENVIRONMENT: environment,
    DATABASE_URL: h.connectionString,
    GOOGLE_PLAY_CREDENTIALS_FILE: '/fixture/never-read',
    GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GOOGLE_RTDN_AUDIENCE:
      'https://fixture.test/api/v1/android/commerce/google/rtdn',
    GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: 'push@fixture.iam.gserviceaccount.com',
    GOOGLE_RTDN_SUBSCRIPTION: 'projects/fixture/subscriptions/live',
  });
  const policy = new AndroidPolicy(config),
    gateway = new GoogleGateway(policy);
  const purchases = new GooglePurchaseService(
    h.prisma as PrismaService,
    policy,
    gateway,
    new EntitlementService(config),
  );
  const notifications = new GoogleNotificationsService(
    h.prisma as PrismaService,
    policy,
    gateway,
    purchases,
  );
  const token = randomBytes(32).toString('base64url');
  const purchase: PlayPurchase = {
    productLineItem: [
      {
        productId: 'jlpt_day_pass',
        productOfferDetails: { quantity: 1, purchaseOptionId: 'buy' },
      },
    ],
    purchaseStateContext: { purchaseState: 'PENDING' },
    testPurchaseContext: {},
  };
  const get = jest
    .spyOn(gateway, 'purchase')
    .mockImplementation(() => Promise.resolve(structuredClone(purchase)));
  const consume = jest.spyOn(gateway, 'consume').mockResolvedValue();
  const order = jest
    .spyOn(gateway, 'order')
    .mockRejectedValue(new Error('unexpected order read'));
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  jest.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    if (
      typeof url !== 'string' ||
      url !== 'https://www.googleapis.com/oauth2/v3/certs'
    )
      throw Error('unexpected fetch');
    return Promise.resolve(
      new Response(
        JSON.stringify({
          keys: [
            { ...pair.publicKey.export({ format: 'jwk' }), kid: 'fixture' },
          ],
        }),
      ),
    );
  });
  const encode = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ iss: 'https://accounts.google.com', aud: config.get<string>('GOOGLE_RTDN_AUDIENCE'), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, email: config.get<string>('GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL'), email_verified: true })}`;
  const auth = `Bearer ${body}.${sign('RSA-SHA256', Buffer.from(body), pair.privateKey).toString('base64url')}`;
  const envelope = (fields: object = {}, messageId = randomUUID()) => ({
    subscription: config.get<string>('GOOGLE_RTDN_SUBSCRIPTION'),
    message: {
      messageId,
      data: Buffer.from(
        JSON.stringify({
          packageName: 'com.meritledger.app',
          eventTimeMillis: String(Date.now()),
          oneTimeProductNotification: {
            notificationType: 1,
            purchaseToken: token,
            sku: 'jlpt_day_pass',
          },
          ...fields,
        }),
      ).toString('base64'),
    },
  });
  const queued = () =>
    h.prisma.googlePlayPurchase.findUniqueOrThrow({
      where: {
        packageName_tokenHash: {
          packageName: 'com.meritledger.app',
          tokenHash: createHash('sha256').update(token).digest('hex'),
        },
      },
    });
  return {
    config,
    gateway,
    purchases,
    notifications,
    purchase,
    token,
    get,
    consume,
    order,
    auth,
    envelope,
    queued,
  };
}
test('real JWT verification and envelope package checks reject spoofed pushes before queuing', async () => {
  const f = fixture();
  const before = await h.prisma.googlePlayPurchase.count();
  await expect(
    f.notifications.receive('Bearer invalid', f.envelope()),
  ).rejects.toMatchObject({ status: 401 });
  await expect(
    f.notifications.receive(f.auth, f.envelope({ packageName: 'other.app' })),
  ).rejects.toMatchObject({ status: 400 });
  expect(await h.prisma.googlePlayPurchase.count()).toBe(before);
  expect(f.get).not.toHaveBeenCalled();
});
test('verified test context for the actual JLPT SKU becomes terminal; repeat notifications and drain do not refetch or grant', async () => {
  const f = fixture();
  const envelope = f.envelope();
  await f.notifications.receive(f.auth, envelope);
  const row = await f.queued();
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({
    state: 'IGNORED_TEST',
    consumeState: 'NOT_APPLICABLE',
    orderId: null,
    userId: null,
  });
  await f.notifications.receive(f.auth, envelope);
  await f.notifications.receive(f.auth, f.envelope());
  await f.purchases.enqueue(f.token);
  await f.purchases.reconcile(row.id);
  // Observe the real drain selector without draining other fixtures' rows.
  const find = jest
    .spyOn(h.prisma.googlePlayPurchase, 'findMany')
    .mockResolvedValue([]);
  await f.notifications.drain();
  expect(find.mock.calls[0][0]?.where?.state).toEqual({ not: 'IGNORED_TEST' });
  expect(f.get).toHaveBeenCalledTimes(1);
  const controller = new AndroidCommerceController(
    h.prisma as PrismaService,
    new AndroidPolicy(f.config),
    null as never,
    f.purchases,
    null as never,
  );
  await expect(
    controller.verify(
      { currentUser: { id: 'synthetic-request-user' } } as Request,
      { productId: 'jlpt_day_pass', purchaseToken: f.token },
    ),
  ).rejects.toMatchObject({
    status: 409,
    response: { code: 'GOOGLE_TEST_PURCHASE_NOT_SUPPORTED' },
  });
  expect(f.get).toHaveBeenCalledTimes(1);
  expect(f.consume).not.toHaveBeenCalled();
  expect(f.order).not.toHaveBeenCalled();
  expect(
    await h.prisma.billingEvent.count({
      where: { googlePurchaseId: row.id, status: 'PROCESSED' },
    }),
  ).toBe(2);
  expect(
    await h.prisma.paymentOrder.count({ where: { providerPaymentId: row.id } }),
  ).toBe(0);
});
test('payload claiming test cannot terminalize a Google-confirmed live or unresolved purchase', async () => {
  const f = fixture();
  delete f.purchase.testPurchaseContext;
  await f.notifications.receive(
    f.auth,
    f.envelope({ testPurchaseContext: {}, environment: 'test' }),
  );
  const row = await f.queued();
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({
    state: 'AWAITING_OWNER',
    errorCode: 'GOOGLE_OWNER_UNRESOLVED',
  });
});
test('Google lookup failure remains retryable and does not mark the event processed', async () => {
  const f = fixture();
  f.get.mockRejectedValueOnce(new Error('unavailable'));
  await f.notifications.receive(f.auth, f.envelope());
  const row = await f.queued();
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({
    state: 'RECEIVED',
    errorCode: 'GOOGLE_RECONCILIATION_FAILED',
  });
  expect(
    await h.prisma.billingEvent.count({
      where: { googlePurchaseId: row.id, status: 'RECEIVED' },
    }),
  ).toBe(1);
});
test('unrelated real legacy SKU keeps its existing ignored lifecycle boundary', async () => {
  const f = fixture();
  delete f.purchase.testPurchaseContext;
  f.purchase.productLineItem[0].productId = 'ml_pro_lifetime';
  await f.notifications.receive(f.auth, f.envelope());
  const row = await f.queued();
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({ state: 'IGNORED', orderId: null });
  expect(f.consume).not.toHaveBeenCalled();
});
test('stale lease cannot commit terminal ignore or process its event', async () => {
  const f = fixture();
  await f.notifications.receive(f.auth, f.envelope());
  const row = await f.queued();
  f.get.mockImplementationOnce(async () => {
    await h.prisma.googlePlayPurchase.update({
      where: { id: row.id },
      data: { leaseUntil: new Date(0) },
    });
    return structuredClone(f.purchase);
  });
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({ state: 'RECEIVED' });
  expect(
    await h.prisma.billingEvent.count({
      where: { googlePurchaseId: row.id, status: 'RECEIVED' },
    }),
  ).toBe(1);
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({ state: 'IGNORED_TEST' });
});
test('matching test environment keeps its normal pending lifecycle', async () => {
  const f = fixture('test');
  const row = await f.purchases.enqueue(f.token);
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({ state: 'AWAITING_OWNER' });
});
test('an already linked live order is never terminally ignored on contradictory test evidence', async () => {
  const f = fixture();
  const user = await h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Live fixture',
      googlePlayAccountId: randomUUID(),
    },
  });
  delete f.purchase.testPurchaseContext;
  f.purchase.obfuscatedExternalAccountId = user.googlePlayAccountId!;
  f.purchase.purchaseStateContext.purchaseState = 'PURCHASED';
  f.purchase.orderId = `GPA.${randomUUID()}`;
  f.purchase.purchaseCompletionTime = new Date().toISOString();
  f.order.mockResolvedValue({
    orderId: f.purchase.orderId,
    purchaseToken: f.token,
    state: 'PROCESSED',
    lastEventTime: new Date().toISOString(),
    createTime: new Date().toISOString(),
    total: { currencyCode: 'JPY', units: '150', nanos: 0 },
    lineItems: [{ productId: 'jlpt_day_pass' }],
  });
  const row = await f.purchases.enqueue(f.token);
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({
    state: 'VERIFIED',
    userId: user.id,
    consumeState: 'CONSUMED',
  });
  f.purchase.testPurchaseContext = {};
  await f.purchases.enqueue(f.token);
  await f.purchases.reconcile(row.id);
  expect(await f.queued()).toMatchObject({
    state: 'VERIFIED',
    errorCode: 'GOOGLE_RECONCILIATION_FAILED',
  });
  expect(
    await h.prisma.entitlementGrant.count({
      where: { userId: user.id, status: 'ACTIVE' },
    }),
  ).toBe(1);
});
