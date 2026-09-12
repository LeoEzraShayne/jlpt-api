import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { StripeGateway } from '../../src/billing/stripe.gateway';
import { StripeWebhookService } from '../../src/billing/stripe-webhook.service';
import { BillingService } from '../../src/billing/billing.service';
let h: AcceptanceDatabase;
const secret = 'whsec_acceptance_fixture_only';
beforeAll(async () => {
  h = await acceptanceDatabase();
  // Force receipt insert overlap (realistic slow database), without mocking SQL.
  await h.sql
    .query(`CREATE FUNCTION f_delay_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW."eventId" LIKE 'evt_race_%' THEN PERFORM pg_sleep(0.05); END IF; RETURN NEW; END $$;
    CREATE TRIGGER f_receipt_latency BEFORE INSERT ON "BillingEvent" FOR EACH ROW EXECUTE FUNCTION f_delay_receipt();`);
});
afterAll(async () => {
  await h?.stop();
});
async function fixture() {
  const user = await h.prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, displayName: 'F Stripe' },
  });
  const order = await h.prisma.paymentOrder.create({
    data: {
      userId: user.id,
      provider: 'STRIPE',
      environment: 'test',
      productCode: 'DAY_PASS',
      market: 'GLOBAL',
      currency: 'USD',
      amount: 99,
      durationSeconds: 86400,
      requestKey: randomUUID(),
      snapshot: {},
    },
  });
  const paymentId = `pi_${randomUUID()}`;
  const sessionId = `cs_test_${randomUUID()}`;
  const charge = {
    id: `ch_${randomUUID()}`,
    paid: true,
    created: Math.floor(Date.now() / 1000),
    amount_refunded: 0,
    payment_intent: paymentId,
  };
  const payment = {
    id: paymentId,
    livemode: false,
    amount: 99,
    currency: 'usd',
    status: 'succeeded',
    latest_charge: charge,
    metadata: { orderId: order.id, userId: user.id, environment: 'test' },
  };
  const session = {
    id: sessionId,
    livemode: false,
    mode: 'payment',
    client_reference_id: user.id,
    amount_total: 99,
    currency: 'usd',
    metadata: { orderId: order.id },
    payment_intent: paymentId,
    status: 'complete',
  };
  let disputes: { status: string }[] = [];
  const sdk = new Stripe('sk_test_acceptance_fixture_only');
  const config = new ConfigService({
    STRIPE_SECRET_KEY: 'sk_test_acceptance_fixture_only',
    STRIPE_WEBHOOK_SECRET: secret,
    BILLING_ENVIRONMENT: 'test',
    FRONTEND_URL: 'https://example.test',
  });
  const gateway = new StripeGateway(config);
  const provider = {
    webhooks: sdk.webhooks,
    checkout: {
      sessions: {
        retrieve: jest.fn(() => Promise.resolve(structuredClone(session))),
      },
    },
    paymentIntents: {
      retrieve: jest.fn(() => Promise.resolve(structuredClone(payment))),
    },
    charges: {
      retrieve: jest.fn(() => Promise.resolve(structuredClone(charge))),
    },
    refunds: {
      retrieve: jest.fn(() => Promise.resolve({ payment_intent: paymentId })),
    },
    disputes: {
      retrieve: jest.fn(() => Promise.resolve({ payment_intent: paymentId })),
      list: jest.fn(() => Promise.resolve({ data: structuredClone(disputes) })),
    },
  };
  jest
    .spyOn(gateway, 'stripe', 'get')
    .mockReturnValue(provider as unknown as Stripe);
  const webhook = new StripeWebhookService(
    h.prisma as PrismaService,
    gateway,
    new EntitlementService(config),
  );
  async function send(
    type = 'checkout.session.completed',
    id = `evt_${randomUUID()}`,
    ageSeconds = 0,
  ) {
    const objectId = type.startsWith('checkout.')
      ? sessionId
      : type.startsWith('payment_intent.')
        ? paymentId
        : type.startsWith('charge.dispute.')
          ? 'dp_fixture'
          : charge.id;
    const raw = JSON.stringify({
      id,
      object: 'event',
      type,
      created: Math.floor(Date.now() / 1000) - ageSeconds,
      livemode: false,
      data: { object: { id: objectId } },
    });
    const signature = sdk.webhooks.generateTestHeaderString({
      payload: raw,
      secret,
    });
    return webhook.receive(Buffer.from(raw), signature);
  }
  return {
    user,
    order,
    payment,
    charge,
    session,
    provider,
    webhook,
    send,
    gateway,
    config,
    setDisputes: (value: { status: string }[]) => {
      disputes = value;
    },
  };
}

test('real signature validation rejects tampered input before durable event writes', async () => {
  const f = await fixture();
  const before = await h.prisma.billingEvent.count();
  await expect(
    f.webhook.receive(Buffer.from('{"id":"forged"}'), 'invalid'),
  ).rejects.toMatchObject({ response: { code: 'INVALID_STRIPE_SIGNATURE' } });
  expect(await h.prisma.billingEvent.count()).toBe(before);
});

test('concurrent duplicate verified events create one grant and one durable receipt', async () => {
  const f = await fixture();
  const id = `evt_race_${randomUUID()}`;
  const deliveries = await Promise.allSettled(
    Array.from({ length: 6 }, () => f.send('checkout.session.completed', id)),
  );
  expect(deliveries.map((r) => r.status)).toEqual(Array(6).fill('fulfilled'));

  expect(
    await h.prisma.entitlementGrant.count({ where: { orderId: f.order.id } }),
  ).toBe(1);
  expect(
    await h.prisma.billingEvent.count({
      where: { eventId: id, status: 'PROCESSED' },
    }),
  ).toBe(1);
  expect(
    (
      await h.prisma.paymentOrder.findUniqueOrThrow({
        where: { id: f.order.id },
      })
    ).status,
  ).toBe('PAID');
});

test('refund before completion and delayed failure do not regress financial state or restore refunded time', async () => {
  const f = await fixture();
  f.charge.amount_refunded = 99;
  await f.send('charge.refunded');
  await f.send('checkout.session.completed', undefined, 600);
  await f.send('payment_intent.payment_failed', undefined, 1200);
  expect(
    await h.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: f.order.id },
    }),
  ).toMatchObject({ status: 'REFUNDED', refundedAmount: 99 });
  expect(
    await h.prisma.entitlementGrant.findUniqueOrThrow({
      where: { orderId: f.order.id },
    }),
  ).toMatchObject({ status: 'REVOKED' });
});

test('partial refund retains entitlement; dispute closed won restores once', async () => {
  const f = await fixture();
  await f.send();
  f.charge.amount_refunded = 20;
  await f.send('charge.refunded');
  expect(
    (
      await h.prisma.paymentOrder.findUniqueOrThrow({
        where: { id: f.order.id },
      })
    ).status,
  ).toBe('PARTIALLY_REFUNDED');
  expect(
    (
      await h.prisma.entitlementGrant.findUniqueOrThrow({
        where: { orderId: f.order.id },
      })
    ).status,
  ).toBe('ACTIVE');
  f.setDisputes([{ status: 'needs_response' }]);
  await f.send('charge.dispute.created');
  expect(
    (
      await h.prisma.entitlementGrant.findUniqueOrThrow({
        where: { orderId: f.order.id },
      })
    ).status,
  ).toBe('SUSPENDED');
  f.setDisputes([{ status: 'won' }]);
  const id = `evt_${randomUUID()}`;
  await f.send('charge.dispute.closed', id);
  await f.send('charge.dispute.closed', id);
  expect(
    (
      await h.prisma.entitlementGrant.findUniqueOrThrow({
        where: { orderId: f.order.id },
      })
    ).status,
  ).toBe('ACTIVE');
  expect(
    await h.prisma.entitlementGrant.count({ where: { orderId: f.order.id } }),
  ).toBe(1);
});

test('retryable provider failure leaves failed receipt and retry reconciles without losing the event', async () => {
  const f = await fixture();
  const id = `evt_${randomUUID()}`;
  f.provider.paymentIntents.retrieve.mockRejectedValueOnce(
    new Error('fixture provider outage'),
  );
  await expect(f.send('checkout.session.completed', id)).rejects.toMatchObject({
    response: { code: 'PAYMENT_UNAVAILABLE' },
  });
  expect(
    (await h.prisma.billingEvent.findFirstOrThrow({ where: { eventId: id } }))
      .status,
  ).toBe('FAILED');
  await f.send('checkout.session.completed', id);
  expect(
    (await h.prisma.billingEvent.findFirstOrThrow({ where: { eventId: id } }))
      .status,
  ).toBe('PROCESSED');
  expect(
    await h.prisma.entitlementGrant.count({ where: { orderId: f.order.id } }),
  ).toBe(1);
});

test.each(['owner', 'amount', 'environment'])(
  'authoritative %s mismatch never grants membership',
  async (field) => {
    const f = await fixture();
    if (field === 'owner') f.payment.metadata.userId = 'another-account';
    if (field === 'amount') f.payment.amount = 1;
    if (field === 'environment') f.payment.livemode = true;
    await expect(f.send()).rejects.toMatchObject({
      response: { code: 'PAYMENT_UNAVAILABLE' },
    });
    expect(
      await h.prisma.entitlementGrant.count({ where: { orderId: f.order.id } }),
    ).toBe(0);
  },
);

test('order detail and pagination cursor are private to the authenticated owner', async () => {
  const f = await fixture();
  const service = new BillingService(
    h.prisma as PrismaService,
    f.gateway,
    f.config,
  );
  await expect(
    service.order('another-account', f.order.id),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    service.orders('another-account', f.order.id),
  ).rejects.toMatchObject({ status: 404 });
  expect((await service.orders(f.user.id)).data.map((o) => o.id)).toContain(
    f.order.id,
  );
});
