import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentOrder } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type {
  BillingMarket,
  Catalog,
  OrderSummary,
  ProductCode,
} from '../contracts/sentence-lab';
import { billingError, catalogFor } from './billing.policy';
import { lockBillingUser } from './entitlement.service';
import { StripeGateway } from './stripe.gateway';

export interface CheckoutInput {
  productCode: ProductCode;
  market: BillingMarket;
  requestKey: string;
  locale: 'zh' | 'en';
}

function ensureCreationWindow(snapshot: unknown) {
  const policy = snapshot as {
    checkoutExpiryPolicy?: string;
    checkoutCreationEndsAt?: string;
  };
  if (
    policy.checkoutExpiryPolicy === 'CHECKOUT_60M_V1' &&
    (!policy.checkoutCreationEndsAt ||
      !Number.isFinite(Date.parse(policy.checkoutCreationEndsAt)) ||
      Date.parse(policy.checkoutCreationEndsAt) <= Date.now())
  )
    billingError('CHECKOUT_EXPIRED');
}
export function presentOrder(order: PaymentOrder): OrderSummary {
  return {
    id: order.id,
    provider: order.provider,
    productCode: order.productCode as ProductCode,
    currency: order.currency,
    amount: order.amount,
    durationSeconds: order.durationSeconds,
    status: order.status,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    refundedAmount: order.refundedAmount,
  };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: StripeGateway,
    private readonly config: ConfigService,
  ) {}
  async catalog(market: BillingMarket): Promise<Catalog> {
    return catalogFor(
      await this.prisma.billingConfig.findUnique({ where: { id: 'default' } }),
      market,
    );
  }
  async orders(userId: string, cursor?: string, limit = 20) {
    if (
      cursor &&
      !(await this.prisma.paymentOrder.findFirst({
        where: { id: cursor, userId, environment: this.gateway.environment },
      }))
    )
      throw new NotFoundException();
    const rows = await this.prisma.paymentOrder.findMany({
      where: { userId, environment: this.gateway.environment },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return {
      data: rows.slice(0, limit).map(presentOrder),
      meta: { nextCursor: rows.length > limit ? rows[limit - 1].id : null },
    };
  }
  async order(userId: string, id: string) {
    const row = await this.prisma.paymentOrder.findFirst({
      where: { id, userId, environment: this.gateway.environment },
    });
    if (!row)
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    return presentOrder(row);
  }
  private priceId(productCode: string, currency: string, launchPrice: boolean) {
    const suffix =
      productCode === 'DAY_PASS'
        ? `DAY_${currency}`
        : currency === 'JPY'
          ? 'YEAR_JPY'
          : `YEAR_USD_${launchPrice ? 'LAUNCH' : 'STANDARD'}`;
    return this.config.get<string>(`STRIPE_PRICE_${suffix}`);
  }
  async checkout(userId: string, input: CheckoutInput) {
    // Force runtime key/environment validation before creating a durable quote.
    const stripe = this.gateway.stripe;
    const order = await this.prisma.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      const previous = await tx.paymentOrder.findUnique({
        where: { userId_requestKey: { userId, requestKey: input.requestKey } },
      });
      if (previous) {
        if (
          previous.productCode !== input.productCode ||
          previous.market !== input.market ||
          previous.environment !== this.gateway.environment
        )
          billingError('IDEMPOTENCY_CONFLICT');
        return previous;
      }
      const config = await tx.billingConfig.findUnique({
        where: { id: 'default' },
      });
      if (
        !config?.salesEnabled ||
        !config.launchAt ||
        config.launchAt > new Date()
      )
        billingError('BILLING_DISABLED', 503);
      const catalog = catalogFor(config, input.market);
      const price = catalog.products.find(
        (p) => p.productCode === input.productCode,
      )!;
      const quotedAt = Math.floor(Date.now() / 1000) * 1000;
      return tx.paymentOrder.create({
        data: {
          userId,
          requestKey: input.requestKey,
          provider: 'STRIPE',
          environment: this.gateway.environment,
          market: input.market,
          ...price,
          expiresAt: new Date(quotedAt + 60 * 60_000),
          snapshot: {
            ...price,
            market: input.market,
            locale: input.locale,
            paymentMethodPolicy: 'CARD_ONLY_V1',
            currencyPolicy: 'USD_FIXED_V1',
            checkoutExpiryPolicy: 'CHECKOUT_60M_V1',
            checkoutCreationEndsAt: new Date(
              quotedAt + 25 * 60_000,
            ).toISOString(),
            launchAt: catalog.launchAt,
            launchEndsAt: catalog.launchEndsAt,
            stripePriceId:
              this.priceId(
                price.productCode,
                price.currency,
                price.launchPrice,
              ) ?? null,
          },
        },
      });
    });
    if (
      order.status !== 'PENDING' ||
      !order.expiresAt ||
      order.expiresAt.getTime() <= Date.now()
    )
      billingError('CHECKOUT_EXPIRED');
    if (order.checkoutUrl)
      return { orderId: order.id, checkoutUrl: order.checkoutUrl };
    ensureCreationWindow(order.snapshot);
    const frontend = new URL(this.config.getOrThrow<string>('FRONTEND_URL'))
      .origin;
    try {
      const priceId = (order.snapshot as { stripePriceId?: string })
        .stripePriceId;
      if (order.environment === 'live' && !priceId)
        billingError('PAYMENT_UNAVAILABLE', 503);
      if (priceId) {
        const price = await stripe.prices.retrieve(priceId);
        if (
          !price.active ||
          price.type !== 'one_time' ||
          price.unit_amount !== order.amount ||
          price.currency.toUpperCase() !== order.currency ||
          price.livemode !== (order.environment === 'live')
        )
          billingError('PAYMENT_UNAVAILABLE', 503);
      }
      // Price reads can be slow. Leave at least five minutes above Stripe's
      // 30-minute minimum for network delay and the SDK's bounded retries.
      ensureCreationWindow(order.snapshot);
      // Persisted quote parameters keep provider idempotency stable across retries.
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          ...((order.snapshot as { currencyPolicy?: string }).currencyPolicy ===
          'USD_FIXED_V1'
            ? { adaptive_pricing: { enabled: false } }
            : {}),
          // Legacy quotes omit this parameter exactly as their original request did.
          ...((order.snapshot as { paymentMethodPolicy?: string })
            .paymentMethodPolicy === 'CARD_ONLY_V1'
            ? { payment_method_types: ['card' as const] }
            : {}),
          client_reference_id: userId,
          metadata: {
            orderId: order.id,
            userId,
            environment: order.environment,
          },
          payment_intent_data: {
            metadata: {
              orderId: order.id,
              userId,
              environment: order.environment,
            },
          },
          locale:
            (order.snapshot as { locale?: string }).locale === 'zh'
              ? 'zh'
              : 'en',
          line_items: priceId
            ? [{ price: priceId, quantity: 1 }]
            : [
                {
                  price_data: {
                    currency: order.currency.toLowerCase(),
                    unit_amount: order.amount,
                    product_data: {
                      name:
                        order.productCode === 'DAY_PASS'
                          ? 'JLPT Sentence Lab · 24 hours'
                          : 'JLPT Sentence Lab · 365 days',
                    },
                  },
                  quantity: 1,
                },
              ],
          success_url: `${frontend}/membership/return?orderId=${encodeURIComponent(order.id)}`,
          cancel_url: `${frontend}/membership`,
          expires_at: Math.floor(order.expiresAt.getTime() / 1000),
        },
        { idempotencyKey: `checkout:${order.id}` },
      );
      if (!session.url || session.livemode !== (order.environment === 'live'))
        billingError('PAYMENT_UNAVAILABLE', 503);
      const saved = await this.prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          providerOrderId: session.id,
          checkoutUrl: session.url,
          expiresAt: new Date(session.expires_at * 1000),
        },
      });
      if (!saved.checkoutUrl) billingError('PAYMENT_UNAVAILABLE', 503);
      return { orderId: order.id, checkoutUrl: session.url };
    } catch (error) {
      if (
        error instanceof HttpException &&
        (error.getResponse() as { code?: string }).code === 'CHECKOUT_EXPIRED'
      )
        throw error;
      billingError('PAYMENT_UNAVAILABLE', 503);
    }
  }
}
