import { ConfigService } from '@nestjs/config';
import { Injectable, Optional } from '@nestjs/common';
import type { Prisma, EntitlementGrant } from '@prisma/client';
import { DAY_SECONDS, GIFT_EMAIL } from './billing.policy';

export async function lockBillingUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
}

/** Remaining time is frozen on suspension and debited only while the grant is active. */
export function remainingMillis(grant: EntitlementGrant, now: Date) {
  if (grant.status === 'SUSPENDED' && grant.remainingSeconds !== null)
    return grant.remainingSeconds * 1000;
  return Math.max(
    0,
    grant.endsAt.getTime() - Math.max(now.getTime(), grant.startsAt.getTime()),
  );
}

@Injectable()
export class EntitlementService {
  constructor(@Optional() private readonly config?: ConfigService) {}
  private environmentFilter() {
    const environment =
      this.config?.get('BILLING_ENVIRONMENT', 'test') === 'live'
        ? 'LIVE'
        : 'TEST';
    return {
      source: {
        in: ['LAUNCH_GIFT', `STRIPE_${environment}`, `GOOGLE_${environment}`],
      },
    };
  }

  async ensureGift(
    tx: Prisma.TransactionClient,
    userId: string,
    now = new Date(),
  ) {
    const config = await tx.billingConfig.findUnique({
      where: { id: 'default' },
    });
    if (!config?.launchAt || config.launchAt > now) return;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user?.email.toLowerCase() !== GIFT_EMAIL) return;
    await tx.entitlementGrant.upsert({
      where: { sourceKey: `launch-vip:${GIFT_EMAIL}` },
      update: {},
      create: {
        userId,
        sourceKey: `launch-vip:${GIFT_EMAIL}`,
        source: 'LAUNCH_GIFT',
        durationSeconds: 365 * DAY_SECONDS,
        startsAt: config.launchAt,
        endsAt: new Date(config.launchAt.getTime() + 365 * DAY_SECONDS * 1000),
      },
    });
  }

  async membership(
    tx: Prisma.TransactionClient,
    userId: string,
    now = new Date(),
  ) {
    await this.ensureGift(tx, userId, now);
    const grants = await tx.entitlementGrant.findMany({
      where: {
        userId,
        ...this.environmentFilter(),
        status: 'ACTIVE',
        endsAt: { gt: now },
      },
      orderBy: { startsAt: 'asc' },
    });
    let tail = now.getTime();
    let active = false;
    for (const grant of grants) {
      if (grant.startsAt.getTime() > tail) break;
      tail = Math.max(tail, grant.endsAt.getTime());
      active = true;
    }
    return { isMember: active, expiresAt: active ? new Date(tail) : null };
  }

  async grantOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
    paidAt: Date,
  ) {
    const order = await tx.paymentOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    const existing = await tx.entitlementGrant.findUnique({
      where: { orderId },
    });
    if (existing) return existing;
    await this.ensureGift(tx, order.userId);
    const last = await tx.entitlementGrant.findFirst({
      where: {
        userId: order.userId,
        ...this.environmentFilter(),
        status: 'ACTIVE',
      },
      orderBy: { endsAt: 'desc' },
    });
    const startsAt = new Date(
      Math.max(paidAt.getTime(), last?.endsAt.getTime() ?? 0),
    );
    return tx.entitlementGrant.create({
      data: {
        userId: order.userId,
        orderId,
        sourceKey: `order:${order.id}`,
        source: `${order.provider}_${order.environment.toUpperCase()}`,
        durationSeconds: order.durationSeconds,
        startsAt,
        endsAt: new Date(startsAt.getTime() + order.durationSeconds * 1000),
      },
    });
  }

  /** Caller holds User lock. Only unconsumed future time moves; unrelated sources survive. */
  async changeOrderGrant(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: 'ACTIVE' | 'REVOKED' | 'SUSPENDED',
    now = new Date(),
  ) {
    const target = await tx.entitlementGrant.findUnique({ where: { orderId } });
    if (!target || target.status === status || target.status === 'REVOKED')
      return;
    const remaining = remainingMillis(target, now);
    await tx.entitlementGrant.update({
      where: { id: target.id },
      data: {
        status,
        revokedAt: status === 'REVOKED' ? now : null,
        remainingSeconds: Math.ceil(remaining / 1000),
        consumedSeconds: target.durationSeconds - Math.ceil(remaining / 1000),
        ...(status === 'SUSPENDED'
          ? {
              metadata: {
                suspendedRemainingMs: remaining,
                suspendedAt: now.toISOString(),
              },
            }
          : {}),
        ...(status === 'ACTIVE'
          ? {
              startsAt: now,
              endsAt: new Date(now.getTime() + remaining),
              metadata: { restoredAt: now.toISOString() },
            }
          : {}),
      },
    });
    const grants = await tx.entitlementGrant.findMany({
      where: {
        userId: target.userId,
        ...this.environmentFilter(),
        status: 'ACTIVE',
        endsAt: { gt: now },
      },
      orderBy: [{ startsAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    let tail = now.getTime();
    for (const grant of grants) {
      // Promotional gift has a fixed launch interval and is never shifted.
      if (grant.source === 'LAUNCH_GIFT') {
        tail = Math.max(tail, grant.endsAt.getTime());
        continue;
      }
      const duration = remainingMillis(grant, now);
      const startsAt = new Date(tail);
      const endsAt = new Date(tail + duration);
      await tx.entitlementGrant.update({
        where: { id: grant.id },
        data: {
          startsAt,
          endsAt,
          remainingSeconds: Math.ceil(duration / 1000),
          consumedSeconds: grant.durationSeconds - Math.ceil(duration / 1000),
        },
      });
      tail = endsAt.getTime();
    }
  }
}
