import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  createDeletionFixture,
  rehearseDeletion,
} from '../../scripts/deletion/synthetic-rehearsal';
import type { AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { StripeGateway } from '../../src/billing/stripe.gateway';
import { StripeWebhookService } from '../../src/billing/stripe-webhook.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  GoogleGateway,
  type PlayOrder,
  type PlayPurchase,
} from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import { MeteredAiClient } from '../../src/ai/metered-ai-client';
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

test('dry-run inventories every model with counts and does not delete or scrub', async () => {
  const f = await fixture();
  const before = await h.prisma.paymentOrder.findUniqueOrThrow({
    where: { id: f.order.id },
  });
  const report = await rehearseDeletion(h);
  expect(report.mode).toBe('DRY_RUN');
  expect(report.productionReady).toBe(false);
  expect(report.plan.length).toBe(48);
  expect(
    report.plan.find((p) => p.table === 'VocabularyPracticeAttempt'),
  ).toMatchObject({ action: 'DELETE', count: 1 });
  expect(report.plan.find((p) => p.table === 'AiReviewJob')).toMatchObject({
    count: 1,
  });
  expect(report.plan.find((p) => p.table === 'AndroidSession')).toMatchObject({
    count: 1,
  });
  expect(await h.prisma.user.count()).toBe(1);
  expect(
    await h.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: f.order.id },
    }),
  ).toEqual(before);
  expect(JSON.stringify(report)).not.toContain(f.user.email);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('synthetic apply clears FK and scalar learning/session data, preserves shared content and minimized financial evidence', async () => {
  const f = await fixture();
  await rehearseDeletion(h, { applySynthetic: true });
  for (const table of [
    'AuthAccount',
    'AuthSession',
    'AndroidSession',
    'AndroidBindingRequest',
    'RewardTicket',
    'RewardEvent',
    'QuotaAccount',
    'QuotaPeriod',
    'TaskSubmission',
    'TaskAuthorization',
    'StudySession',
    'SentenceAttempt',
    'AiReviewJob',
    'VocabularyEntry',
    'VocabularyLearning',
    'VocabularyPractice',
    'VocabularyPracticeAttempt',
  ]) {
    const result = await h.sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${table}"`,
    );
    expect({ table, count: result.rows[0].count }).toEqual({ table, count: 0 });
  }
  expect(await h.prisma.grammarPoint.count()).toBe(1);
  expect(
    await h.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: f.order.id },
    }),
  ).toMatchObject({
    amount: 99,
    currency: 'USD',
    userId: f.user.id,
    checkoutUrl: null,
    snapshot: {},
  });
  expect(
    await h.prisma.entitlementGrant.findUniqueOrThrow({
      where: { orderId: f.order.id },
    }),
  ).toMatchObject({ status: 'REVOKED', metadata: null });
  expect(await h.prisma.aiUsageRecord.findFirstOrThrow()).toMatchObject({
    userId: null,
    taskKind: null,
    taskKey: null,
    rawUsage: null,
  });
  expect(
    (await h.prisma.aiUsageRecord.findFirstOrThrow()).costUsd?.toString(),
  ).toBe('0.0001');
  expect(await h.prisma.billingEvent.findFirstOrThrow()).toMatchObject({
    payload: {},
  });
});

test('in-flight AI is reported, admin scope blocks writes, and non-minted handles are rejected', async () => {
  const f = await fixture();
  await expect(
    rehearseDeletion({ ...h }, { applySynthetic: true }),
  ).rejects.toThrow('FRESH_SYNTHETIC_DATABASE_REQUIRED');
  await h.prisma.aiReviewJob.updateMany({ data: { status: 'PROCESSING' } });
  expect((await rehearseDeletion(h)).admittedWorkCount).toBeGreaterThan(0);
  expect(await h.prisma.androidSession.count()).toBe(1);
  expect(
    (await h.prisma.paymentOrder.findFirstOrThrow()).checkoutUrl,
  ).not.toBeNull();
  await h.prisma.aiReviewJob.updateMany({ data: { status: 'QUEUED' } });
  await h.prisma.importBatch.create({
    data: {
      operatorId: f.user.id,
      dataset: 'synthetic',
      fileName: 'synthetic',
      fileHash: 'synthetic',
      status: 'DRY_RUN',
      summary: {},
    },
  });
  expect((await rehearseDeletion(h)).blockers).toContain(
    'MANUAL_REVIEW:ImportBatch',
  );
  await expect(rehearseDeletion(h, { applySynthetic: true })).rejects.toThrow(
    'DELETION_BLOCKED',
  );
});

test('cross-account private-vocabulary references require review before cascade', async () => {
  const f = await fixture();
  const other = await h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Other synthetic',
    },
  });
  const word = await h.prisma.vocabularyEntry.findFirstOrThrow({
    where: { ownerId: f.user.id },
  });
  await h.prisma.vocabularyBookmark.create({
    data: { userId: other.id, vocabularyId: word.id },
  });
  await expect(rehearseDeletion(h, { applySynthetic: true })).rejects.toThrow(
    'GIFT_OR_CROSS_ACCOUNT_SCOPE_REQUIRES_REVIEW',
  );
  expect(await h.prisma.user.count()).toBe(2);
  expect(await h.prisma.vocabularyBookmark.count()).toBe(1);
});

test('transaction failure rolls back scrubbing and all deletions', async () => {
  await fixture();
  await h.sql
    .query(`CREATE FUNCTION synthetic_stop_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback'; END $$;
    CREATE TRIGGER synthetic_stop BEFORE DELETE ON "AuthAccount" FOR EACH ROW EXECUTE FUNCTION synthetic_stop_delete();`);
  await expect(rehearseDeletion(h, { applySynthetic: true })).rejects.toThrow(
    'synthetic rollback',
  );
  expect(await h.prisma.androidSession.count()).toBe(1);
  expect(
    (await h.prisma.paymentOrder.findFirstOrThrow()).checkoutUrl,
  ).not.toBeNull();
  expect(
    (await h.prisma.aiUsageRecord.findFirstOrThrow()).userId,
  ).not.toBeNull();
});

test('late Stripe success reconciles money without recreating a grant for a deleted account', async () => {
  const f = await fixture();
  // A pending order had no existing grant when the deletion happened.
  await h.prisma.entitlementGrant.deleteMany();
  await rehearseDeletion(h, { applySynthetic: true });
  const config = new ConfigService({
    BILLING_ENVIRONMENT: 'test',
    STRIPE_SECRET_KEY: 'sk_test_synthetic',
    STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
  });
  const gateway = new StripeGateway(config);
  const sdk = new Stripe('sk_test_synthetic');
  const payment = {
    id: 'pi_synthetic',
    livemode: false,
    amount: 99,
    currency: 'usd',
    status: 'succeeded',
    metadata: { userId: f.user.id, orderId: f.order.id, environment: 'test' },
    latest_charge: {
      paid: true,
      created: Math.floor(Date.now() / 1000),
      amount_refunded: 0,
    },
  };
  jest.spyOn(gateway, 'stripe', 'get').mockReturnValue({
    webhooks: sdk.webhooks,
    paymentIntents: { retrieve: () => Promise.resolve(payment) },
    disputes: { list: () => Promise.resolve({ data: [] }) },
  } as unknown as Stripe);
  const webhook = new StripeWebhookService(
    h.prisma as PrismaService,
    gateway,
    new EntitlementService(config),
  );
  const payload = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: payment.id } },
  });
  await webhook.receive(
    Buffer.from(payload),
    sdk.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_synthetic',
    }),
  );
  expect(
    await h.prisma.user.count({ where: { deletedAt: { not: null } } }),
  ).toBe(1);
  expect(
    await h.prisma.entitlementGrant.count({
      where: { userId: f.user.id, status: 'ACTIVE' },
    }),
  ).toBe(0);
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each([false, true])(
  'Google late accounting works when deletion preceded the first token delivery: %s',
  async (deletedBeforeDelivery) => {
    const f = await fixture();
    const config = new ConfigService({
      ANDROID_COMMERCE_ENVIRONMENT: 'test',
      BILLING_ENVIRONMENT: 'test',
      DATABASE_URL: h.connectionString,
      GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    });
    const policy = new AndroidPolicy(config),
      gateway = new GoogleGateway(policy);
    const service = new GooglePurchaseService(
      h.prisma as PrismaService,
      policy,
      gateway,
      new EntitlementService(config),
    );
    const token = randomUUID();
    const purchase: PlayPurchase = {
      testPurchaseContext: { fopType: 'TEST' },
      orderId: 'GPA.synthetic',
      obfuscatedExternalAccountId: f.user.googlePlayAccountId!,
      productLineItem: [
        {
          productId: 'jlpt_day_pass',
          productOfferDetails: {
            quantity: 1,
            purchaseOptionId: 'buy',
            consumptionState: 'CONSUMPTION_STATE_CONSUMED',
          },
        },
      ],
      purchaseStateContext: { purchaseState: 'PURCHASED' },
    };
    const order: PlayOrder = {
      orderId: 'GPA.synthetic',
      purchaseToken: token,
      state: 'PROCESSED',
      createTime: new Date().toISOString(),
      lastEventTime: new Date().toISOString(),
      total: { currencyCode: 'USD', units: '0', nanos: 990000000 },
      lineItems: [{ productId: 'jlpt_day_pass' }],
    };
    jest
      .spyOn(gateway, 'purchase')
      .mockImplementation(() => Promise.resolve(structuredClone(purchase)));
    jest
      .spyOn(gateway, 'order')
      .mockImplementation(() => Promise.resolve(structuredClone(order)));
    const consume = jest.spyOn(gateway, 'consume').mockResolvedValue();
    if (deletedBeforeDelivery)
      await rehearseDeletion(h, { applySynthetic: true });
    const row = await service.enqueue(token);
    await service.reconcile(row.id);
    expect(
      await h.prisma.googlePlayPurchase.findUniqueOrThrow({
        where: { id: row.id },
      }),
    ).toMatchObject({ userId: f.user.id, state: 'VERIFIED' });
    if (deletedBeforeDelivery) {
      expect(
        await h.prisma.googlePlayPurchase.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toMatchObject({
        consumeState: 'MANUAL_REVIEW',
        errorCode: 'GOOGLE_DELETED_ACCOUNT_MANUAL_REVIEW',
      });
      expect(consume).not.toHaveBeenCalled();
      expect(
        await h.prisma.entitlementGrant.count({
          where: { userId: f.user.id, status: 'ACTIVE' },
        }),
      ).toBe(0);
    } else await rehearseDeletion(h, { applySynthetic: true });
    order.state = 'REFUNDED';
    await service.enqueue(token);
    await service.reconcile(row.id);
    const after = await h.prisma.googlePlayPurchase.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after.errorCode).toBeNull();
    expect(
      await h.prisma.paymentOrder.findUniqueOrThrow({
        where: { id: after.orderId! },
      }),
    ).toMatchObject({ status: 'REFUNDED', refundedAmount: 99 });
    expect(
      await h.prisma.user.count({ where: { deletedAt: { not: null } } }),
    ).toBe(1);
    expect(global.fetch).not.toHaveBeenCalled();
  },
);

test('late metered AI attempt is rejected before network admission after deletion', async () => {
  const f = await fixture();
  await rehearseDeletion(h, { applySynthetic: true });
  jest.mocked(global.fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        model: 'deepseek-chat',
        choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      { status: 200 },
    ),
  );
  const client = new MeteredAiClient(
    new ConfigService({ DEEPSEEK_API_KEY: 'synthetic_not_a_key' }),
    h.prisma as PrismaService,
  );
  await expect(
    client.request(
      'DEEPSEEK',
      'synthetic',
      'GRAMMAR_REVIEW',
      { userId: f.user.id, taskKey: f.study.id },
      (text) => JSON.parse(text) as unknown,
    ),
  ).rejects.toMatchObject({
    code: 'AI_METERING_UNAVAILABLE',
    retryable: false,
  });
  expect(global.fetch).not.toHaveBeenCalled();
  expect(
    await h.prisma.aiUsageRecord.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(
    await h.prisma.user.count({ where: { deletedAt: { not: null } } }),
  ).toBe(1);
});
