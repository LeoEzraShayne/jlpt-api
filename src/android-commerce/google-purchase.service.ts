import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { GooglePlayPurchase, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  EntitlementService,
  lockBillingUser,
} from '../billing/entitlement.service';
import { DAY_SECONDS } from '../billing/billing.policy';
import { AndroidPolicy, androidHash } from './android.policy';
import {
  GoogleGateway,
  type PlayOrder,
  type PlayPurchase,
} from './google.gateway';
import { moneyMinor, orderRefund, timestampNanos } from './google-money';
type Fence = Pick<GooglePlayPurchase, 'id' | 'leaseToken' | 'revision'>;
const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
@Injectable()
export class GooglePurchaseService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: AndroidPolicy,
    private readonly gateway: GoogleGateway,
    private readonly grants: EntitlementService,
  ) {}
  async enqueue(token: string, tx: Prisma.TransactionClient = this.db) {
    this.policy.assertIsolation();
    if (!token || token.length > 8192) throw new Error('GOOGLE_TOKEN_INVALID');
    const key = {
      packageName: this.policy.packageName,
      tokenHash: androidHash(token),
    };
    await tx.googlePlayPurchase.createMany({
      skipDuplicates: true,
      data: {
        ...key,
        environment: this.policy.environment,
        tokenCiphertext: this.gateway.encrypt(token),
      },
    });
    const row = await tx.googlePlayPurchase.findUniqueOrThrow({
      where: { packageName_tokenHash: key },
    });
    if (row.environment !== this.policy.environment)
      throw new Error('GOOGLE_ENVIRONMENT_MISMATCH');
    if (row.state === 'IGNORED_TEST') return row;
    return tx.googlePlayPurchase.update({
      where: { id: row.id },
      data: { revision: { increment: 1 }, nextAttemptAt: new Date() },
    });
  }
  async claim(id: string) {
    const row = await this.db.googlePlayPurchase.findUnique({ where: { id } });
    if (
      !row ||
      row.environment !== this.policy.environment ||
      row.packageName !== this.policy.packageName ||
      row.state === 'IGNORED_TEST'
    )
      return null;
    const leaseToken = randomUUID();
    const changed = await this.db.googlePlayPurchase.updateMany({
      where: {
        id,
        state: { not: 'IGNORED_TEST' },
        revision: row.revision,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: {
        leaseToken,
        leaseUntil: new Date(Date.now() + 120_000),
        attempts: { increment: 1 },
      },
    });
    return changed.count
      ? this.db.googlePlayPurchase.findUniqueOrThrow({ where: { id } })
      : null;
  }
  private fence(row: Fence) {
    return {
      id: row.id,
      revision: row.revision,
      leaseToken: row.leaseToken,
      leaseUntil: { gt: new Date() },
    };
  }
  private async release(
    row: Fence,
    data: Prisma.GooglePlayPurchaseUpdateManyMutationInput,
  ) {
    return this.db.googlePlayPurchase.updateMany({
      where: this.fence(row),
      data: { ...data, leaseToken: null, leaseUntil: null },
    });
  }
  async reconcile(id: string) {
    this.policy.assertIsolation();
    const row = await this.claim(id);
    if (!row) return;
    try {
      const token = this.gateway.decrypt(row.tokenCiphertext);
      const purchase = await this.gateway.purchase(token);
      const item = purchase.productLineItem[0];
      if (purchase.productLineItem.length !== 1 || !item)
        throw new Error('GOOGLE_ITEMS_INVALID');
      if (
        row.environment === 'live' &&
        purchase.testPurchaseContext &&
        ['jlpt_day_pass', 'jlpt_year_pass'].includes(item.productId) &&
        !row.orderId
      ) {
        await this.db.$transaction(async (tx) => {
          const ignored = await tx.googlePlayPurchase.updateMany({
            where: { ...this.fence(row), orderId: null },
            data: {
              state: 'IGNORED_TEST',
              productId: item.productId,
              consumeState: 'NOT_APPLICABLE',
              evidence: json({ testPurchase: true, productId: item.productId }),
              errorCode: null,
              verifiedAt: new Date(),
              leaseToken: null,
              leaseUntil: null,
            },
          });
          if (ignored.count !== 1) throw new Error('GOOGLE_LEASE_LOST');
          await tx.billingEvent.updateMany({
            where: { googlePurchaseId: row.id, status: { not: 'PROCESSED' } },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
              errorCode: null,
            },
          });
        });
        return;
      }
      if (!!purchase.testPurchaseContext !== (row.environment === 'test'))
        throw new Error('GOOGLE_ENVIRONMENT_MISMATCH');
      if (!['jlpt_day_pass', 'jlpt_year_pass'].includes(item.productId)) {
        await this.release(row, {
          state: 'IGNORED',
          nextAttemptAt: new Date(Date.now() + 30 * DAY_SECONDS * 1000),
          errorCode: null,
        });
        return;
      }
      if (
        item.productOfferDetails?.quantity !== 1 ||
        item.productOfferDetails.purchaseOptionId !== 'buy' ||
        (item.productOfferDetails.offerId &&
          !(
            item.productId === 'jlpt_year_pass' &&
            item.productOfferDetails.offerId === 'launch-64'
          ))
      )
        throw new Error('GOOGLE_PRODUCT_INVALID');
      const order = purchase.orderId
        ? await this.gateway.order(purchase.orderId)
        : null;
      if (
        order &&
        (order.purchaseToken !== token ||
          order.orderId !== purchase.orderId ||
          order.lineItems.length !== 1 ||
          order.lineItems[0].productId !== item.productId)
      )
        throw new Error('GOOGLE_ORDER_MISMATCH');
      if (
        order &&
        row.googleLastEventTime &&
        timestampNanos(order.lastEventTime) <
          timestampNanos(row.googleLastEventTime)
      ) {
        await this.release(row, {
          nextAttemptAt: new Date(Date.now() + 60_000),
          errorCode: 'GOOGLE_STALE_SNAPSHOT',
        });
        return;
      }
      const owner = purchase.obfuscatedExternalAccountId
        ? await this.db.user.findUnique({
            where: {
              googlePlayAccountId: purchase.obfuscatedExternalAccountId,
            },
            select: { id: true },
          })
        : null;
      if (row.userId && owner?.id !== row.userId)
        throw new Error('GOOGLE_OWNER_MISMATCH');
      const refunded = row.state === 'REFUNDED' || order?.state === 'REFUNDED';
      if (!owner) {
        await this.release(row, {
          state: refunded ? 'REFUNDED' : 'AWAITING_OWNER',
          productId: item.productId,
          googleOrderId: purchase.orderId,
          googleLastEventTime: order?.lastEventTime,
          nextAttemptAt: new Date(Date.now() + 300_000),
          errorCode: 'GOOGLE_OWNER_UNRESOLVED',
        });
        return;
      }
      if (
        !order ||
        (!refunded &&
          purchase.purchaseStateContext.purchaseState !== 'PURCHASED')
      ) {
        await this.release(row, {
          userId: owner.id,
          productId: item.productId,
          state: refunded
            ? 'REFUNDED'
            : purchase.purchaseStateContext.purchaseState === 'CANCELLED'
              ? 'CANCELLED'
              : 'PENDING',
          nextAttemptAt: new Date(Date.now() + 300_000),
          errorCode: null,
        });
        return;
      }
      if (
        !refunded &&
        !['PROCESSED', 'PENDING_REFUND', 'PARTIALLY_REFUNDED'].includes(
          order.state,
        )
      )
        throw new Error('GOOGLE_ORDER_STATE_INVALID');
      const committed = await this.commit(
        row,
        owner.id,
        purchase,
        order,
        refunded,
      );
      if (!committed) return;
      const finalRefunded = committed === 'REFUNDED';
      if (committed === 'DELETED_ACCOUNT') {
        await this.release(row, {
          consumeState: 'MANUAL_REVIEW',
          errorCode: 'GOOGLE_DELETED_ACCOUNT_MANUAL_REVIEW',
          nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000),
        });
        return;
      }
      if (
        !finalRefunded &&
        item.productOfferDetails.consumptionState !==
          'CONSUMPTION_STATE_CONSUMED'
      ) {
        const valid = await this.db.googlePlayPurchase.count({
          where: this.fence(row),
        });
        if (!valid) return;
        await this.gateway.consume(item.productId, token);
      }
      await this.release(row, {
        consumeState: finalRefunded ? 'NOT_APPLICABLE' : 'CONSUMED',
        errorCode: null,
        nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000),
      });
    } catch {
      await this.release(row, {
        errorCode: 'GOOGLE_RECONCILIATION_FAILED',
        nextAttemptAt: new Date(
          Date.now() + Math.min(3600, 2 ** Math.min(row.attempts, 10)) * 1000,
        ),
      });
    }
  }
  private async commit(
    row: GooglePlayPurchase,
    userId: string,
    purchase: PlayPurchase,
    order: PlayOrder,
    refunded: boolean,
  ) {
    const item = purchase.productLineItem[0];
    const amount = moneyMinor(order.total);
    const refundedAmount = refunded ? amount : orderRefund(order, amount);
    const paidAt = purchase.purchaseCompletionTime
      ? new Date(purchase.purchaseCompletionTime)
      : new Date(order.createTime);
    if (!Number.isFinite(paidAt.getTime()))
      throw new Error('GOOGLE_TIME_INVALID');
    return this.db.$transaction(async (tx) => {
      await lockBillingUser(tx, userId, true);
      const owner = await tx.user.findUnique({
        where: { id: userId },
        select: { deletedAt: true },
      });
      if (!owner) throw new Error('GOOGLE_OWNER_MISSING');
      const fenced = await tx.googlePlayPurchase.updateMany({
        where: this.fence(row),
        data: { verifiedAt: new Date() },
      });
      if (!fenced.count) return false;
      const current = await tx.googlePlayPurchase.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (current.userId && current.userId !== userId)
        throw new Error('GOOGLE_OWNER_MISMATCH');
      let local = current.orderId
        ? await tx.paymentOrder.findUniqueOrThrow({
            where: { id: current.orderId },
          })
        : null;
      if (
        local &&
        (local.userId !== userId ||
          local.amount !== amount ||
          local.currency !== order.total.currencyCode ||
          local.environment !== row.environment)
      )
        throw new Error('GOOGLE_PAYMENT_MISMATCH');
      const full = refunded || local?.status === 'REFUNDED';
      const refund = Math.max(
        local?.refundedAmount ?? 0,
        full ? amount : refundedAmount,
      );
      const status =
        full || (amount > 0 && refund === amount)
          ? 'REFUNDED'
          : refund
            ? 'PARTIALLY_REFUNDED'
            : 'PAID';
      const productCode =
        item.productId === 'jlpt_day_pass' ? 'DAY_PASS' : 'YEAR_PASS';
      const durationSeconds =
        (productCode === 'DAY_PASS' ? 1 : 365) * DAY_SECONDS;
      if (!local)
        local = await tx.paymentOrder.create({
          data: {
            userId,
            provider: 'GOOGLE',
            environment: row.environment,
            productCode,
            market: purchase.regionCode ?? 'GLOBAL',
            currency: order.total.currencyCode,
            amount,
            durationSeconds,
            launchPrice: item.productOfferDetails?.offerId === 'launch-64',
            status,
            requestKey: `google:${row.tokenHash}`,
            providerOrderId: `google:${row.environment}:${order.orderId}`,
            providerPaymentId: `google-token:${androidHash(`${row.packageName}:${this.gateway.decrypt(row.tokenCiphertext)}`)}`,
            paidAt,
            refundedAmount: refund,
            snapshot: json({
              productId: item.productId,
              purchaseOptionId: item.productOfferDetails?.purchaseOptionId,
              offerId: item.productOfferDetails?.offerId ?? null,
              money: order.total,
              googleLastEventTime: order.lastEventTime,
            }),
          },
        });
      else
        local = await tx.paymentOrder.update({
          where: { id: local.id },
          data: { status, refundedAmount: refund },
        });
      if (owner.deletedAt)
        await this.grants.changeOrderGrant(tx, local.id, 'REVOKED');
      else if (status !== 'REFUNDED')
        await this.grants.grantOrder(tx, local.id, local.paidAt!);
      else await this.grants.changeOrderGrant(tx, local.id, 'REVOKED');
      const committed = await tx.googlePlayPurchase.updateMany({
        where: this.fence(row),
        data: {
          userId,
          productId: item.productId,
          purchaseOptionId: item.productOfferDetails?.purchaseOptionId,
          offerId: item.productOfferDetails?.offerId ?? null,
          orderId: local.id,
          googleOrderId: order.orderId,
          googleLastEventTime: order.lastEventTime,
          state: status === 'REFUNDED' ? 'REFUNDED' : 'VERIFIED',
          consumeState: status === 'REFUNDED' ? 'NOT_APPLICABLE' : 'PENDING',
          errorCode: null,
          evidence: json({
            state: order.state,
            money: order.total,
            refundAmount: refund,
            googleLastEventTime: order.lastEventTime,
          }),
        },
      });
      // The lease can expire while the ledger transaction is running. Never
      // commit an entitlement without its durable queue link and final fence.
      if (committed.count !== 1) throw new Error('GOOGLE_LEASE_LOST');
      await tx.billingEvent.updateMany({
        where: { googlePurchaseId: row.id, status: { not: 'PROCESSED' } },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
          orderId: local.id,
          errorCode: null,
        },
      });
      return status === 'REFUNDED'
        ? 'REFUNDED'
        : owner.deletedAt
          ? 'DELETED_ACCOUNT'
          : 'VERIFIED';
    });
  }
}
