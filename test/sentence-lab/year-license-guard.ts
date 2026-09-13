import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  PlayOrder,
  PlayPurchase,
} from '../../src/android-commerce/google.gateway';
import {
  moneyMinor,
  orderRefund,
} from '../../src/android-commerce/google-money';

export const yearManifest = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  packageName: z.literal('com.meritledger.app'),
  productId: z.literal('jlpt_year_pass'),
  purchaseOptionId: z.literal('buy'),
  offerId: z.literal('launch-64'),
  currency: z.literal('JPY'),
  priceAmountMicros: z.literal(9824000000),
  obfuscatedAccountId: z.string().uuid(),
});
export type YearManifest = z.infer<typeof yearManifest>;
export const yearExport = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  purchaseState: z.literal('PURCHASED'),
  productId: z.literal('jlpt_year_pass'),
  purchaseToken: z.string().min(20).max(8192),
  observedAt: z.string().datetime(),
});
export const yearPin = z.object({
  runId: z.string().uuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  googleOrderId: z.string().min(1),
  completionTime: z.string().min(1),
});
export type YearPin = z.infer<typeof yearPin>;
export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');
const requireMatch = (ok: boolean, code: string) => {
  if (!ok) throw Error(code);
};

/** Authoritative Google evidence only. Client state/price/email never grants anything. */
export function guardYearPurchase(
  manifest: YearManifest,
  token: string,
  purchase: PlayPurchase,
  order: PlayOrder,
  mode: 'paid' | 'refunded',
  pin?: YearPin,
) {
  const item = purchase.productLineItem[0];
  const details = item?.productOfferDetails;
  requireMatch(
    purchase.testPurchaseContext?.fopType === 'TEST',
    'LICENSE_TEST_REQUIRED',
  );
  requireMatch(
    purchase.obfuscatedExternalAccountId === manifest.obfuscatedAccountId,
    'SYNTHETIC_OWNER_REQUIRED',
  );
  requireMatch(
    purchase.productLineItem.length === 1 &&
      item?.productId === manifest.productId &&
      details?.purchaseOptionId === 'buy' &&
      details.offerId === 'launch-64' &&
      details.quantity === 1,
    'EXACT_YEAR_OFFER_REQUIRED',
  );
  requireMatch(
    purchase.regionCode === 'JP' &&
      order.total.currencyCode === 'JPY' &&
      moneyMinor(order.total) === 9824,
    'EXACT_YEAR_PRICE_REQUIRED',
  );
  requireMatch(
    order.purchaseToken === token &&
      order.lineItems.length === 1 &&
      order.lineItems[0].productId === manifest.productId &&
      (purchase.orderId === order.orderId ||
        (mode === 'refunded' &&
          !purchase.orderId &&
          pin?.googleOrderId === order.orderId)),
    'GOOGLE_ORDER_BINDING_REQUIRED',
  );
  const completed = Date.parse(purchase.purchaseCompletionTime ?? '');
  requireMatch(
    Number.isFinite(completed) &&
      completed >= Date.parse(manifest.createdAt) &&
      completed <= Date.parse(manifest.expiresAt),
    'FRESH_RUN_PURCHASE_REQUIRED',
  );
  requireMatch(
    mode === 'paid'
      ? purchase.purchaseStateContext.purchaseState === 'PURCHASED' &&
          order.state === 'PROCESSED' &&
          orderRefund(order, 9824) === 0
      : ['PURCHASED', 'CANCELLED'].includes(
          purchase.purchaseStateContext.purchaseState,
        ) &&
          order.state === 'REFUNDED' &&
          orderRefund(order, 9824) === 9824,
    'GOOGLE_TERMINAL_STATE_REQUIRED',
  );
  const target: YearPin = {
    runId: manifest.runId,
    tokenHash: tokenHash(token),
    googleOrderId: order.orderId,
    completionTime: purchase.purchaseCompletionTime!,
  };
  if (pin)
    requireMatch(
      Object.keys(target).every(
        (key) => target[key as keyof YearPin] === pin[key as keyof YearPin],
      ),
      'PINNED_PURCHASE_REQUIRED',
    );
  return target;
}
