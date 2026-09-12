import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { StripeGateway } from '../../src/billing/stripe.gateway';
async function main() {
  const config = new ConfigService(process.env);
  if (
    config.get('BILLING_ENVIRONMENT') !== 'test' ||
    !new URL(config.getOrThrow('DATABASE_URL')).pathname.includes(
      'payments_20260913',
    )
  )
    throw new Error('Sandbox-only guard');
  const db = new PrismaService(config);
  const stripe = new StripeGateway(config).stripe;
  const id = process.argv[2];
  if (!id) throw new Error('Pass the paid sandbox order ID');
  const waitFor = async (status: string) => {
    for (let i = 0; i < 40; i++) {
      const order = await db.paymentOrder.findUniqueOrThrow({ where: { id } });
      if (order.status === status) return order;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Webhook did not produce ${status}`);
  };
  try {
    const order = await db.paymentOrder.findUniqueOrThrow({ where: { id } });
    if (
      order.environment !== 'test' ||
      !order.providerPaymentId ||
      !order.paidAt
    )
      throw new Error('Expected paid sandbox order');
    const events = await stripe.events.list({
      type: 'payment_intent.succeeded',
      limit: 100,
    });
    const event = events.data.find(
      (e) =>
        ('id' in e.data.object ? e.data.object.id : null) ===
        order.providerPaymentId,
    );
    if (!event) throw new Error('Payment event not found');
    const raw = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: raw,
      secret: config.getOrThrow('STRIPE_WEBHOOK_SECRET'),
    });
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        fetch('http://localhost:4502/api/v1/billing/webhooks/stripe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': signature,
          },
          body: raw,
        }),
      ),
    );
    if (responses.some((r) => !r.ok))
      throw new Error('Duplicate replay failed');
    if ((await db.entitlementGrant.count({ where: { orderId: id } })) !== 1)
      throw new Error('Duplicate grant');
    if (!order.refundedAmount) {
      await stripe.refunds.create(
        { payment_intent: order.providerPaymentId, amount: 20 },
        { idempotencyKey: `acceptance-partial:${id}` },
      );
      const partial = await waitFor('PARTIALLY_REFUNDED');
      const grant = await db.entitlementGrant.findUniqueOrThrow({
        where: { orderId: id },
      });
      if (partial.refundedAmount !== 20 || grant.status !== 'ACTIVE')
        throw new Error('Partial refund policy mismatch');
      console.log(
        'PASS: signed duplicate delivery creates one grant; partial refund records 20 cents and keeps membership.',
      );
    }
    await stripe.refunds.create(
      { payment_intent: order.providerPaymentId },
      { idempotencyKey: `acceptance-full:${id}` },
    );
    const refunded = await waitFor('REFUNDED');
    const grant = await db.entitlementGrant.findUniqueOrThrow({
      where: { orderId: id },
    });
    if (refunded.refundedAmount !== order.amount || grant.status !== 'REVOKED')
      throw new Error('Full refund policy mismatch');
    console.log(
      'PASS: full Stripe sandbox refund reconciles exact amount and revokes only its source.',
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Failed');
  process.exitCode = 1;
});
