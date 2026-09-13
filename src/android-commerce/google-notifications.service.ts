import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../database/prisma.service';
import { billingError } from '../billing/billing.policy';
import { AndroidPolicy, androidHash } from './android.policy';
import { GoogleGateway } from './google.gateway';
import { GooglePurchaseService } from './google-purchase.service';
const notification = z.object({
  packageName: z.string(),
  eventTimeMillis: z.string(),
  testNotification: z.object({ version: z.string() }).optional(),
  oneTimeProductNotification: z
    .object({
      notificationType: z.number().int(),
      purchaseToken: z.string().min(1).max(8192),
      sku: z.string(),
    })
    .optional(),
  voidedPurchaseNotification: z
    .object({
      purchaseToken: z.string().min(1).max(8192),
      orderId: z.string().optional(),
    })
    .optional(),
});
@Injectable()
export class GoogleNotificationsService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: AndroidPolicy,
    private readonly gateway: GoogleGateway,
    private readonly purchases: GooglePurchaseService,
  ) {}
  async record(eventId: string, eventType: string, token?: string) {
    return this.db.$transaction(async (tx) => {
      const key = {
        provider: 'GOOGLE',
        environment: this.policy.environment,
        eventId,
      };
      const created = await tx.billingEvent.createMany({
        skipDuplicates: true,
        data: {
          ...key,
          eventType,
          payload: { tokenHash: token ? androidHash(token) : null },
          status: token ? 'RECEIVED' : 'PROCESSED',
          processedAt: token ? null : new Date(),
        },
      });
      if (!created.count) return;
      if (token) {
        const queue = await this.purchases.enqueue(token, tx);
        await tx.billingEvent.update({
          where: { provider_environment_eventId: key },
          data: {
            googlePurchaseId: queue.id,
            ...(queue.state === 'IGNORED_TEST'
              ? { status: 'PROCESSED', processedAt: new Date() }
              : {}),
          },
        });
      }
    });
  }
  async receive(auth: string | undefined, body: unknown) {
    this.policy.assertIsolation();
    await this.gateway.verifyPush(auth);
    const envelope = z
      .object({
        subscription: z.string(),
        message: z.object({
          messageId: z.string().min(1).max(200),
          data: z.string().max(40000),
        }),
      })
      .safeParse(body);
    if (
      !envelope.success ||
      envelope.data.subscription !==
        this.policy.config.get('GOOGLE_RTDN_SUBSCRIPTION')
    )
      billingError('INVALID_RTDN_ENVELOPE', 400);
    const encoded = envelope.data.message.data;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
      billingError('INVALID_RTDN_ENVELOPE', 400);
    let parsed: z.infer<typeof notification>;
    try {
      parsed = notification.parse(
        JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')),
      );
    } catch {
      billingError('INVALID_RTDN_ENVELOPE', 400);
    }
    if (parsed.packageName !== this.policy.packageName)
      billingError('INVALID_RTDN_PACKAGE', 400);
    const token =
      parsed.oneTimeProductNotification?.purchaseToken ??
      parsed.voidedPurchaseNotification?.purchaseToken;
    const type = parsed.testNotification
      ? 'TEST'
      : parsed.voidedPurchaseNotification
        ? 'VOIDED_HINT'
        : parsed.oneTimeProductNotification
          ? 'PURCHASE_HINT'
          : 'UNSUPPORTED';
    await this.record(
      `${envelope.data.subscription}:${envelope.data.message.messageId}`,
      type,
      token,
    );
    return { received: true };
  }
  @Interval(15_000)
  async drain() {
    if (!this.policy.config.get('GOOGLE_PLAY_CREDENTIALS_FILE')) return;
    try {
      this.policy.assertIsolation();
      const rows = await this.db.googlePlayPurchase.findMany({
        where: {
          environment: this.policy.environment,
          packageName: this.policy.packageName,
          state: { not: 'IGNORED_TEST' },
          nextAttemptAt: { lte: new Date() },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
        },
        take: 10,
        orderBy: { nextAttemptAt: 'asc' },
        select: { id: true },
      });
      for (const row of rows) await this.purchases.reconcile(row.id);
    } catch {
      /* Persistent rows remain available; no raw provider error or token is logged. */
    }
  }
  @Interval(60 * 60_000)
  async syncVoided() {
    if (!this.policy.config.get('GOOGLE_PLAY_CREDENTIALS_FILE')) return;
    this.policy.assertIsolation();
    const id = `google-voided:${this.policy.packageName}:${this.policy.environment}`;
    await this.db.androidCommerceSyncState.createMany({
      skipDuplicates: true,
      data: { id },
    });
    const leaseToken = randomUUID();
    const leaseUntil = new Date(Date.now() + 10 * 60_000);
    const claimed = await this.db.androidCommerceSyncState.updateMany({
      where: {
        id,
        OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
      },
      data: { leaseToken, leaseUntil },
    });
    if (!claimed.count) return;
    const fence = () => ({ id, leaseToken, leaseUntil: { gt: new Date() } });
    try {
      const state = await this.db.androidCommerceSyncState.findUniqueOrThrow({
        where: { id },
      });
      const end = Date.now();
      const earliest = end - 30 * 86400_000;
      if (state.watermarkAt && state.watermarkAt.getTime() < earliest)
        throw new Error('GOOGLE_VOIDED_HISTORY_GAP');
      const overlapStart = state.watermarkAt
        ? state.watermarkAt.getTime() - 86400_000
        : undefined;
      // A local now-minus-30-days is already too old when Google receives it.
      // Omit the boundary so Google uses its own full retention window; never
      // shorten bootstrap history by adding an arbitrary safety margin.
      const start =
        overlapStart !== undefined && overlapStart > earliest
          ? overlapStart
          : undefined;
      let pageToken: string | undefined;
      const seen = new Set<string>();
      do {
        if (!(await this.db.androidCommerceSyncState.count({ where: fence() })))
          return;
        const page = await this.gateway.voided(start, end, pageToken);
        for (const item of page.voidedPurchases)
          await this.record(
            `voided:${androidHash(`${item.purchaseToken}:${item.orderId ?? ''}:${item.voidedTimeMillis ?? ''}`)}`,
            'VOIDED_SYNC',
            item.purchaseToken,
          );
        pageToken = page.tokenPagination?.nextPageToken;
        if (pageToken && seen.has(pageToken))
          throw new Error('GOOGLE_VOIDED_PAGE_LOOP');
        if (pageToken) seen.add(pageToken);
      } while (pageToken);
      await this.db.androidCommerceSyncState.updateMany({
        where: fence(),
        data: {
          watermarkAt: new Date(end),
          lastSuccessAt: new Date(),
          errorCode: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
    } catch (error) {
      await this.db.androidCommerceSyncState.updateMany({
        where: fence(),
        data: {
          errorCode:
            error instanceof Error &&
            error.message === 'GOOGLE_VOIDED_HISTORY_GAP'
              ? 'GOOGLE_VOIDED_HISTORY_GAP'
              : 'GOOGLE_VOIDED_SYNC_FAILED',
          leaseToken: null,
          leaseUntil: null,
        },
      });
    }
  }
}
