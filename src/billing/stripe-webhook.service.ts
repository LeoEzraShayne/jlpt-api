import { Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import type { PaymentOrder } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { billingError } from './billing.policy';
import { EntitlementService, lockBillingUser } from './entitlement.service';
import { StripeGateway } from './stripe.gateway';

function stripeId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id;
}

@Injectable()
export class StripeWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: StripeGateway,
    private readonly entitlements: EntitlementService,
  ) {}
  async receive(raw: Buffer, signature: string) {
    const event = this.gateway.verify(raw, signature);
    const key = {
      provider: 'STRIPE',
      environment: this.gateway.environment,
      eventId: event.id,
    };
    const receipt = await this.prisma.billingEvent.upsert({
      where: { provider_environment_eventId: key },
      update: {},
      create: {
        ...key,
        eventType: event.type,
        providerCreatedAt: new Date(event.created * 1000),
        payload: {
          objectId: 'id' in event.data.object ? event.data.object.id : '',
        },
      },
    });
    if (receipt.status === 'PROCESSED') return { received: true };
    try {
      for (let retry = 0; retry < 8; retry++) {
        const state = await this.authoritative(event);
        if (!state) {
          await this.prisma.billingEvent.update({
            where: { id: receipt.id },
            data: { status: 'PROCESSED', processedAt: new Date() },
          });
          return { received: true };
        }
        const committed = await this.prisma.$transaction(async (tx) => {
          await lockBillingUser(tx, state.order.userId);
          const duplicate = await tx.billingEvent.findUniqueOrThrow({
            where: { id: receipt.id },
          });
          if (duplicate.status === 'PROCESSED') return true;
          const order = await tx.paymentOrder.findUniqueOrThrow({
            where: { id: state.order.id },
          });
          const revision = await tx.billingEvent.count({
            where: { orderId: order.id, status: 'PROCESSED' },
          });
          if (revision !== state.revision) return false;
          {
            const refundedAmount = Math.max(
              order.refundedAmount,
              state.refundedAmount,
            );
            const fullRefund =
              refundedAmount >= order.amount || order.status === 'REFUNDED';
            const status = fullRefund
              ? 'REFUNDED'
              : state.disputed
                ? 'DISPUTED'
                : state.paid
                  ? refundedAmount
                    ? 'PARTIALLY_REFUNDED'
                    : 'PAID'
                  : order.paidAt
                    ? order.status
                    : state.status;
            const updated = await tx.paymentOrder.update({
              where: { id: order.id },
              data: {
                status,
                refundedAmount,
                ...(state.paymentId
                  ? { providerPaymentId: state.paymentId }
                  : {}),
                ...(state.sessionId
                  ? { providerOrderId: state.sessionId }
                  : {}),
                ...(state.paid ? { paidAt: order.paidAt ?? state.paidAt } : {}),
              },
            });
            if (state.paid) {
              await this.entitlements.grantOrder(tx, order.id, updated.paidAt!);
              await this.entitlements.changeOrderGrant(
                tx,
                order.id,
                fullRefund
                  ? 'REVOKED'
                  : state.disputed
                    ? 'SUSPENDED'
                    : 'ACTIVE',
              );
            }
          }
          await tx.billingEvent.update({
            where: { id: receipt.id },
            data: {
              status: 'PROCESSED',
              orderId: order.id,
              processedAt: new Date(),
              errorCode: null,
            },
          });
          return true;
        });
        if (committed) return { received: true };
      }
      throw new Error('Concurrent reconciliation retry required');
    } catch {
      await this.prisma.billingEvent.updateMany({
        where: { id: receipt.id, status: { not: 'PROCESSED' } },
        data: { status: 'FAILED', errorCode: 'STRIPE_RECONCILIATION_FAILED' },
      });
      billingError('PAYMENT_UNAVAILABLE', 503);
    }
  }

  private async authoritative(event: Stripe.Event) {
    const stripe = this.gateway.stripe;
    let session: Stripe.Checkout.Session | undefined;
    let paymentId: string | undefined;
    let metadataOrderId: string | undefined;
    if (event.type.startsWith('checkout.session.')) {
      session = await stripe.checkout.sessions.retrieve(
        'id' in event.data.object ? event.data.object.id : '',
      );
      metadataOrderId = session.metadata?.orderId;
      paymentId = stripeId(session.payment_intent);
    } else if (event.type.startsWith('charge.dispute.')) {
      const dispute = await stripe.disputes.retrieve(
        'id' in event.data.object ? event.data.object.id : '',
      );
      paymentId = stripeId(dispute.payment_intent);
    } else if (event.type.startsWith('charge.')) {
      const charge = await stripe.charges.retrieve(
        'id' in event.data.object ? event.data.object.id : '',
      );
      paymentId = stripeId(charge.payment_intent);
    } else if (event.type.startsWith('refund.')) {
      const refund = await stripe.refunds.retrieve(
        'id' in event.data.object ? event.data.object.id : '',
      );
      paymentId = stripeId(refund.payment_intent);
    } else if (event.type.startsWith('payment_intent.')) {
      paymentId = 'id' in event.data.object ? event.data.object.id : '';
    } else return null;
    let payment = paymentId
      ? await stripe.paymentIntents.retrieve(paymentId, {
          expand: ['latest_charge'],
        })
      : null;
    metadataOrderId ??= payment?.metadata.orderId;
    if (!metadataOrderId) return null; // Another application on the same Stripe account.
    const order = await this.prisma.paymentOrder.findUnique({
      where: { id: metadataOrderId },
    });
    if (!order) throw new Error('Order metadata unresolved');
    const revision = await this.prisma.billingEvent.count({
      where: { orderId: order.id, status: 'PROCESSED' },
    });
    // Re-read after the local revision snapshot. If another reconciliation commits
    // while these provider reads run, retry the provider reads outside the lock.
    if (session) {
      session = await stripe.checkout.sessions.retrieve(session.id);
      paymentId = stripeId(session.payment_intent);
    }
    payment = paymentId
      ? await stripe.paymentIntents.retrieve(paymentId, {
          expand: ['latest_charge'],
        })
      : null;
    this.verifyOrder(order, session, payment);
    const charge =
      payment?.latest_charge && typeof payment.latest_charge !== 'string'
        ? payment.latest_charge
        : null;
    const disputes = paymentId
      ? await stripe.disputes.list({ payment_intent: paymentId, limit: 100 })
      : null;
    const disputed =
      disputes?.data.some(
        (d) => !['won', 'warning_closed'].includes(d.status),
      ) ?? false;
    return {
      order,
      revision,
      sessionId: session?.id,
      paymentId,
      paid: payment?.status === 'succeeded' && !!charge?.paid,
      paidAt: new Date((charge?.created ?? event.created) * 1000),
      refundedAmount: charge?.amount_refunded ?? 0,
      disputed,
      status:
        session?.status === 'expired'
          ? 'EXPIRED'
          : event.type === 'checkout.session.async_payment_failed' ||
              event.type === 'payment_intent.payment_failed'
            ? 'FAILED'
            : 'PENDING',
    };
  }

  private verifyOrder(
    order: PaymentOrder,
    session?: Stripe.Checkout.Session,
    payment?: Stripe.PaymentIntent | null,
  ) {
    if (
      order.environment !== this.gateway.environment ||
      order.provider !== 'STRIPE'
    )
      throw new Error('Environment mismatch');
    if (
      session &&
      (session.livemode !== (order.environment === 'live') ||
        session.mode !== 'payment' ||
        session.client_reference_id !== order.userId ||
        session.amount_total !== order.amount ||
        session.currency?.toUpperCase() !== order.currency ||
        (order.providerOrderId && order.providerOrderId !== session.id))
    )
      throw new Error('Session mismatch');
    if (
      payment &&
      (payment.livemode !== (order.environment === 'live') ||
        payment.amount !== order.amount ||
        payment.currency.toUpperCase() !== order.currency ||
        payment.metadata.userId !== order.userId ||
        payment.metadata.orderId !== order.id ||
        payment.metadata.environment !== order.environment ||
        (order.providerPaymentId && order.providerPaymentId !== payment.id))
    )
      throw new Error('Payment mismatch');
  }
}
