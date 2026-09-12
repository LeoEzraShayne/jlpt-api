import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type Stripe from 'stripe';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { freezeDate } from '../learning-v2/review-fixtures';
import type { PrismaService } from '../../src/database/prisma.service';
import { StripeGateway } from '../../src/billing/stripe.gateway';
import { BillingService } from '../../src/billing/billing.service';
let h: AcceptanceDatabase;
const day = 86400000;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
afterAll(async () => {
  await h?.stop();
});
async function fixture() {
  const user = await h.prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, displayName: 'F quote' },
  });
  const config = new ConfigService({
    STRIPE_SECRET_KEY: 'sk_test_local_fixture_only',
    BILLING_ENVIRONMENT: 'test',
    FRONTEND_URL: 'https://example.test/untrusted-path',
  });
  const gateway = new StripeGateway(config);
  const sessions = new Map<
    string,
    { id: string; url: string; livemode: boolean; expires_at: number }
  >();
  const create = jest.fn(
    (
      params: Stripe.Checkout.SessionCreateParams,
      options: Stripe.RequestOptions,
    ) => {
      const key = options.idempotencyKey!;
      if (!sessions.has(key))
        sessions.set(key, {
          id: `cs_test_${randomUUID()}`,
          url: 'https://checkout.stripe.com/c/pay/fixture',
          livemode: false,
          expires_at: params.expires_at!,
        });
      return Promise.resolve(sessions.get(key)!);
    },
  );
  jest.spyOn(gateway, 'stripe', 'get').mockReturnValue({
    checkout: { sessions: { create } },
  } as unknown as Stripe);
  return {
    user,
    create,
    service: new BillingService(h.prisma as PrismaService, gateway, config),
  };
}

test('checkout snapshots server price, fixed return URLs and one-time mode; parallel replay shares order', async () => {
  const f = await fixture();
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      launchAt: new Date(Date.now() - day),
      salesEnabled: true,
    },
    update: { launchAt: new Date(Date.now() - day), salesEnabled: true },
  });
  const input = {
    productCode: 'YEAR_PASS' as const,
    market: 'JP' as const,
    requestKey: randomUUID(),
    locale: 'en' as const,
  };
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => f.service.checkout(f.user.id, input)),
  );
  expect(new Set(responses.map((r) => r.orderId)).size).toBe(1);
  const order = await h.prisma.paymentOrder.findUniqueOrThrow({
    where: { id: responses[0].orderId },
  });
  expect(order).toMatchObject({
    amount: 6400,
    currency: 'JPY',
    durationSeconds: 365 * 86400,
    launchPrice: false,
  });
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  for (const [params, options] of f.create.mock.calls) {
    expect(params).toMatchObject({
      mode: 'payment',
      locale: 'en',
      client_reference_id: f.user.id,
      success_url: `https://example.test/membership/return?orderId=${order.id}`,
      cancel_url: 'https://example.test/membership',
    });
    expect(options.idempotencyKey).toBe(`checkout:${order.id}`);
  }
  await expect(
    f.service.checkout(f.user.id, { ...input, productCode: 'DAY_PASS' }),
  ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
});

test('quote made before 90-day cutoff keeps USD64 for 30 minutes while new quotes cost USD99.99', async () => {
  const f = await fixture();
  const launchAt = new Date('2026-06-01T00:00:00Z');
  const cutoff = new Date(launchAt.getTime() + 90 * day);
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', launchAt, salesEnabled: true },
    update: { launchAt, salesEnabled: true },
  });
  freezeDate(new Date(cutoff.getTime() - 60000));
  const input = {
    productCode: 'YEAR_PASS' as const,
    market: 'GLOBAL' as const,
    requestKey: randomUUID(),
    locale: 'zh' as const,
  };
  const quote = await f.service.checkout(f.user.id, input);
  const before = await h.prisma.paymentOrder.findUniqueOrThrow({
    where: { id: quote.orderId },
  });
  expect(before.amount).toBe(6400);
  expect(before.expiresAt!.getTime() - Date.now()).toBe(30 * 60000);
  jest.setSystemTime(cutoff);
  expect(await f.service.checkout(f.user.id, input)).toEqual(quote);
  const newQuote = await f.service.checkout(f.user.id, {
    ...input,
    requestKey: randomUUID(),
  });
  expect(
    (
      await h.prisma.paymentOrder.findUniqueOrThrow({
        where: { id: newQuote.orderId },
      })
    ).amount,
  ).toBe(9999);
  expect(
    await h.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: quote.orderId },
    }),
  ).toEqual(before);
});
