import type { PrismaService } from '../../src/database/prisma.service';
import {
  EntitlementService,
  lockBillingUser,
} from '../../src/billing/entitlement.service';
import {
  GIFT_EMAIL,
  launchOfferEndsAt,
} from '../../src/billing/billing.policy';

/** Main-agent operation: singleton lock serializes first activation and retries. */
export async function activateWebBilling(
  db: PrismaService,
  entitlements: EntitlementService,
  now = new Date(),
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(192837465, 1)::text`;
    await tx.billingConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
    await tx.$queryRaw`SELECT id FROM "BillingConfig" WHERE id = 'default' FOR UPDATE`;
    const current = await tx.billingConfig.findUniqueOrThrow({
      where: { id: 'default' },
    });
    if (current.launchAt && current.launchAt > now)
      throw Error('Future launch must be reviewed');
    if (current.enforcementAt && !current.launchAt)
      throw Error('Inconsistent activation timestamps');
    const owner = await tx.user.findUnique({
      where: { email: GIFT_EMAIL },
      select: { id: true },
    });
    if (!owner)
      throw Error('Designated gift account must exist before activation');
    const launchAt = current.launchAt ?? now;
    const enforcementAt = current.enforcementAt ?? launchAt;
    if (enforcementAt > now) throw Error('Future enforcement must be reviewed');
    const config = await tx.billingConfig.update({
      where: { id: 'default' },
      data: {
        launchAt,
        enforcementAt,
        salesEnabled: true,
        enforcementEnabled: true,
        rewardsEnabled: false,
      },
    });
    await lockBillingUser(tx, owner.id);
    await entitlements.ensureGift(tx, owner.id, now);
    const gift = await tx.entitlementGrant.findUniqueOrThrow({
      where: { sourceKey: `launch-vip:${GIFT_EMAIL}` },
    });
    if (
      gift.userId !== owner.id ||
      gift.source !== 'LAUNCH_GIFT' ||
      gift.startsAt.getTime() !== launchAt.getTime() ||
      gift.endsAt.getTime() !== launchAt.getTime() + 365 * 86400_000
    )
      throw Error('Gift conflicts with the immutable launch interval');
    return {
      launchAt: config.launchAt,
      enforcementAt: config.enforcementAt,
      launchEndsAt: launchOfferEndsAt(launchAt),
      salesEnabled: config.salesEnabled,
      enforcementEnabled: config.enforcementEnabled,
      rewardsEnabled: config.rewardsEnabled,
      giftStartsAt: gift.startsAt,
      giftEndsAt: gift.endsAt,
      alreadyActivated: current.launchAt !== null,
    };
  });
}
