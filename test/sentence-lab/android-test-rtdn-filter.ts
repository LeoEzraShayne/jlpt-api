/** Test proxy adapter only: no database writes, no modification of production RTDN semantics. */
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { GoogleGateway } from '../../src/android-commerce/google.gateway';
import { billingError } from '../../src/billing/billing.policy';

const allowedProducts = new Set(['jlpt_day_pass', 'jlpt_year_pass']);
const envelopeSchema = z.object({
  subscription: z.string(),
  message: z.object({
    messageId: z.string().min(1).max(200),
    data: z.string().max(40000),
  }),
});
const notificationSchema = z.object({
  packageName: z.literal('com.meritledger.app'),
  eventTimeMillis: z.string(),
  testNotification: z.object({ version: z.string() }).optional(),
  subscriptionNotification: z
    .object({ purchaseToken: z.string().min(1).max(8192) })
    .optional(),
  oneTimeProductNotification: z
    .object({ sku: z.string(), purchaseToken: z.string().min(1).max(8192) })
    .optional(),
  voidedPurchaseNotification: z
    .object({ purchaseToken: z.string().min(1).max(8192) })
    .optional(),
});

export class AndroidTestRtdnFilter {
  constructor(
    private readonly config: ConfigService,
    private readonly google: Pick<GoogleGateway, 'verifyPush' | 'purchase'>,
  ) {}

  async decide(
    auth: string | undefined,
    body: unknown,
  ): Promise<'forward' | 'filtered'> {
    await this.google.verifyPush(auth);
    const envelope = envelopeSchema.safeParse(body);
    if (
      !envelope.success ||
      envelope.data.subscription !== this.config.get('GOOGLE_RTDN_SUBSCRIPTION')
    )
      billingError('INVALID_RTDN_ENVELOPE', 400);
    const data = envelope.data.message.data;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
      billingError('INVALID_RTDN_ENVELOPE', 400);
    let notification: z.infer<typeof notificationSchema>;
    try {
      notification = notificationSchema.parse(
        JSON.parse(Buffer.from(data, 'base64').toString('utf8')),
      );
    } catch {
      billingError('INVALID_RTDN_ENVELOPE', 400);
    }
    if (
      [
        notification.testNotification,
        notification.subscriptionNotification,
        notification.oneTimeProductNotification,
        notification.voidedPurchaseNotification,
      ].filter(Boolean).length !== 1
    )
      billingError('INVALID_RTDN_ENVELOPE', 400);
    if (notification.testNotification) return 'forward';
    if (notification.subscriptionNotification) return 'filtered';
    if (
      notification.oneTimeProductNotification &&
      !allowedProducts.has(notification.oneTimeProductNotification.sku)
    )
      return 'filtered';
    const token =
      notification.oneTimeProductNotification?.purchaseToken ??
      notification.voidedPurchaseNotification!.purchaseToken;
    // Lookup failure propagates (relay must return 503), leaving Pub/Sub responsible for retry.
    const purchase = await this.google.purchase(token);
    if (!purchase.testPurchaseContext) return 'filtered';
    if (
      purchase.productLineItem.length !== 1 ||
      !allowedProducts.has(purchase.productLineItem[0].productId)
    )
      return 'filtered';
    // Do not require an owner or order: pending tests and RTDN-before-binding must stay durable.
    return 'forward';
  }
}
