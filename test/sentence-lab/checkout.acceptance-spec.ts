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
  const requestParams = new Map<string, string>();
  const retrieve = jest.fn();
  const create = jest.fn(
    (
      params: Stripe.Checkout.SessionCreateParams,
      options: Stripe.RequestOptions,
    ) => {
      const key = options.idempotencyKey!;
      const serialized = JSON.stringify(params);
      if (requestParams.has(key) && requestParams.get(key) !== serialized)
        return Promise.reject(
          new Error('Provider idempotency parameters changed'),
        );
      requestParams.set(key, serialized);
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
    prices: { retrieve },
    checkout: { sessions: { create } },
  } as unknown as Stripe);
  return {
    user,
    create,
    config,
    retrieve,
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
    currency: 'USD',
    durationSeconds: 365 * 86400,
    launchPrice: true,
    snapshot: {
      paymentMethodPolicy: 'CARD_ONLY_V1',
      currencyPolicy: 'USD_FIXED_V1',
    },
  });
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  for (const [params, options] of f.create.mock.calls) {
    expect(params).toMatchObject({
      mode: 'payment',
      payment_method_types: ['card'],
      adaptive_pricing: { enabled: false },
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

test('quote made before 90-day cutoff keeps USD64 for 60 minutes while new quotes cost USD99', async () => {
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
  expect(before.expiresAt!.getTime() - Date.now()).toBe(60 * 60000);
  expect(before.snapshot).toMatchObject({
    checkoutExpiryPolicy: 'CHECKOUT_60M_V1',
    checkoutCreationEndsAt: new Date(Date.now() + 25 * 60000).toISOString(),
  });
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
  ).toBe(9900);
  expect(
    await h.prisma.paymentOrder.findUniqueOrThrow({
      where: { id: quote.orderId },
    }),
  ).toEqual(before);
  jest.setSystemTime(new Date(before.expiresAt!.getTime() - 1));
  expect(await f.service.checkout(f.user.id, input)).toEqual(quote);
  jest.setSystemTime(before.expiresAt!);
  await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
    response: { code: 'CHECKOUT_EXPIRED' },
  });
});

test.each([undefined, 'CARD_ONLY_V1'])(
  'retry after a lost local response preserves the quoted payment-method parameters: %s',
  async (paymentMethodPolicy) => {
    const f = await fixture();
    const input = {
      productCode: 'DAY_PASS' as const,
      market: 'GLOBAL' as const,
      requestKey: randomUUID(),
      locale: 'en' as const,
    };
    const snapshot = {
      productCode: input.productCode,
      currency: 'USD',
      amount: 99,
      durationSeconds: 86400,
      launchPrice: false,
      market: input.market,
      locale: input.locale,
      stripePriceId: null,
      ...(paymentMethodPolicy ? { paymentMethodPolicy } : {}),
    };
    const order = await h.prisma.paymentOrder.create({
      data: {
        userId: f.user.id,
        provider: 'STRIPE',
        environment: 'test',
        productCode: input.productCode,
        market: input.market,
        currency: 'USD',
        amount: 99,
        durationSeconds: 86400,
        requestKey: input.requestKey,
        expiresAt: new Date(Date.now() + 30 * 60000),
        snapshot,
      },
    });
    const providerCreate = f.create.getMockImplementation()!;
    f.create.mockImplementationOnce(async (params, options) => {
      await providerCreate(params, options);
      throw new Error(
        'Simulated response lost after provider accepted the request',
      );
    });
    await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
      response: { code: 'PAYMENT_UNAVAILABLE' },
    });
    const response = await f.service.checkout(f.user.id, input);
    expect(response.orderId).toBe(order.id);
    expect(f.create.mock.calls).toHaveLength(2);
    expect(f.create.mock.calls[1]).toEqual(f.create.mock.calls[0]);
    const [params, options] = f.create.mock.calls[1];
    expect(params).not.toHaveProperty('adaptive_pricing');
    expect(params.expires_at).toBe(
      Math.floor(order.expiresAt!.getTime() / 1000),
    );
    expect(options.idempotencyKey).toBe(`checkout:${order.id}`);
    if (paymentMethodPolicy)
      expect(params.payment_method_types).toEqual(['card']);
    else expect(params).not.toHaveProperty('payment_method_types');
    expect(
      (
        await h.prisma.paymentOrder.findUniqueOrThrow({
          where: { id: order.id },
        })
      ).snapshot,
    ).toEqual(snapshot);
  },
);

test.each(['EXPIRED', 'PAID', 'REFUNDED', 'PENDING'])(
  'a cached URL cannot bypass a closed or expired quote: %s',
  async (status) => {
    const f = await fixture();
    const input = {
      productCode: 'DAY_PASS' as const,
      market: 'GLOBAL' as const,
      requestKey: randomUUID(),
      locale: 'en' as const,
    };
    await h.prisma.paymentOrder.create({
      data: {
        userId: f.user.id,
        provider: 'STRIPE',
        environment: 'test',
        productCode: input.productCode,
        market: input.market,
        currency: 'USD',
        amount: 99,
        durationSeconds: 86400,
        requestKey: input.requestKey,
        status,
        checkoutUrl: 'https://checkout.stripe.com/c/pay/stale',
        expiresAt: new Date(Date.now() + (status === 'PENDING' ? -1 : 60000)),
        snapshot: {},
      },
    });
    await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
      response: { code: 'CHECKOUT_EXPIRED' },
    });
    expect(f.create).not.toHaveBeenCalled();
  },
);

async function enableSales() {
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { launchAt: new Date(Date.now() - day), salesEnabled: true },
    update: { launchAt: new Date(Date.now() - day), salesEnabled: true },
  });
}

test('a delayed response retry keeps the same 60-minute provider expiry and parameters', async () => {
  freezeDate(new Date('2026-09-13T01:00:00Z'));
  await enableSales();
  const f = await fixture();
  const input = {
    productCode: 'DAY_PASS' as const,
    market: 'GLOBAL' as const,
    requestKey: randomUUID(),
    locale: 'en' as const,
  };
  const providerCreate = f.create.getMockImplementation()!;
  f.create.mockImplementationOnce(async (params, options) => {
    await providerCreate(params, options);
    throw new Error('Provider accepted, response lost');
  });
  await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
    response: { code: 'PAYMENT_UNAVAILABLE' },
  });
  jest.setSystemTime(new Date('2026-09-13T01:24:00Z'));
  const response = await f.service.checkout(f.user.id, input);
  expect(f.create.mock.calls[1]).toEqual(f.create.mock.calls[0]);
  expect(f.create.mock.calls[1][0].expires_at! - Date.now() / 1000).toBe(
    36 * 60,
  );
  jest.setSystemTime(new Date('2026-09-13T01:59:00Z'));
  expect(await f.service.checkout(f.user.id, input)).toEqual(response);
  expect(f.create).toHaveBeenCalledTimes(2);
});

test('an uncreated quote cannot retry at the 25-minute cutoff; a new request starts a new quote', async () => {
  freezeDate(new Date('2026-09-13T02:00:00Z'));
  await enableSales();
  const f = await fixture();
  const input = {
    productCode: 'DAY_PASS' as const,
    market: 'GLOBAL' as const,
    requestKey: randomUUID(),
    locale: 'en' as const,
  };
  f.create.mockRejectedValueOnce(new Error('Provider unavailable'));
  await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
    response: { code: 'PAYMENT_UNAVAILABLE' },
  });
  jest.setSystemTime(new Date('2026-09-13T02:25:00Z'));
  await expect(f.service.checkout(f.user.id, input)).rejects.toMatchObject({
    response: { code: 'CHECKOUT_EXPIRED' },
  });
  expect(f.create).toHaveBeenCalledTimes(1);
  await f.service.checkout(f.user.id, { ...input, requestKey: randomUUID() });
  expect(f.create).toHaveBeenCalledTimes(2);
  expect(f.create.mock.calls[1][1].idempotencyKey).not.toBe(
    f.create.mock.calls[0][1].idempotencyKey,
  );
});

test('slow price retrieval rechecks the creation window before contacting Checkout', async () => {
  freezeDate(new Date('2026-09-13T03:00:00Z'));
  await enableSales();
  const f = await fixture();
  f.config.set('STRIPE_PRICE_DAY_USD', 'price_test_day_fixture');
  f.retrieve.mockImplementation(() => {
    jest.setSystemTime(new Date('2026-09-13T03:26:00Z'));
    return Promise.resolve({
      active: true,
      type: 'one_time',
      unit_amount: 99,
      currency: 'usd',
      livemode: false,
    });
  });
  await expect(
    f.service.checkout(f.user.id, {
      productCode: 'DAY_PASS',
      market: 'GLOBAL',
      requestKey: randomUUID(),
      locale: 'en',
    }),
  ).rejects.toMatchObject({ response: { code: 'CHECKOUT_EXPIRED' } });
  expect(f.retrieve).toHaveBeenCalledTimes(1);
  expect(f.create).not.toHaveBeenCalled();
});
