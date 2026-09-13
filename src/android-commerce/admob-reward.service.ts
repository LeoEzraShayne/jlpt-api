import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import {
  EntitlementService,
  lockBillingUser,
} from '../billing/entitlement.service';
import { billingError } from '../billing/billing.policy';
import { AndroidPolicy, androidHash } from './android.policy';
import { AdmobVerifier } from './admob-verifier';
@Injectable()
export class AdmobRewardService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: AndroidPolicy,
    private readonly grants: EntitlementService,
    private readonly verifier: AdmobVerifier,
  ) {}
  async create(userId: string, requestKey: string) {
    this.policy.assertEnabled();
    if (!this.policy.enabled('ANDROID_ADMOB_ENABLED'))
      billingError('ANDROID_REWARDS_DISABLED', 503);
    const adUnitId = this.policy.config.get<string>(
      'ADMOB_REWARDED_AD_UNIT_ID',
    );
    const match = /^ca-app-pub-\d+\/(\d+)$/.exec(adUnitId ?? '');
    if (!match) billingError('ANDROID_AD_UNIT_UNAVAILABLE', 503);
    if (
      this.policy.environment === 'live' &&
      adUnitId?.startsWith('ca-app-pub-3940256099942544/')
    )
      billingError('ANDROID_TEST_AD_UNIT_FORBIDDEN', 503);
    return this.db.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      const flags = await tx.billingConfig.findUnique({
        where: { id: 'default' },
      });
      if (!flags?.androidRewardsEnabled)
        billingError('ANDROID_REWARDS_DISABLED', 503);
      if ((await this.grants.membership(tx, userId)).isMember)
        billingError('MEMBER_ADS_DISABLED', 409);
      const existing = await tx.rewardTicket.findUnique({
        where: {
          userId_environment_requestKey: {
            userId,
            environment: this.policy.environment,
            requestKey,
          },
        },
      });
      if (existing) billingError('TICKET_RESTART_REQUIRED', 409);
      const secret = randomBytes(32).toString('base64url');
      const ticket = await tx.rewardTicket.create({
        data: {
          userId,
          environment: this.policy.environment,
          requestKey,
          secretHash: androidHash(secret),
          ssvUserId: randomBytes(24).toString('base64url'),
          adUnitId: adUnitId!,
          ssvAdUnitId: match[1],
          rewardItem: this.policy.config.get('ADMOB_REWARD_ITEM', 'jlpt_task'),
          expiresAt: new Date(Date.now() + 20 * 60_000),
        },
      });
      return {
        ticketId: ticket.id,
        adUnitId: ticket.adUnitId,
        customData: secret,
        ssvUserId: ticket.ssvUserId,
        expiresAt: ticket.expiresAt.toISOString(),
      };
    });
  }
  async status(userId: string, id: string) {
    this.policy.assertEnabled();
    const ticket = await this.db.rewardTicket.findFirst({
      where: { id, userId, environment: this.policy.environment },
    });
    if (!ticket) billingError('TICKET_NOT_FOUND', 404);
    const account = await this.db.quotaAccount.findUnique({
      where: { userId },
    });
    return {
      status:
        ticket.status === 'REDEEMED'
          ? 'REDEEMED'
          : ticket.expiresAt <= new Date()
            ? 'EXPIRED'
            : 'ISSUED',
      rewardBalance:
        (account?.rewardBalance ?? 0) - (account?.rewardReserved ?? 0),
    };
  }
  async receive(query: string) {
    this.policy.assertIsolation();
    const fields = await this.verifier.verify(query);
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(fields.custom_data ?? '') ||
      !/^\d+$/.test(fields.timestamp ?? '') ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(fields.transaction_id ?? '') ||
      fields.reward_amount !== '1'
    )
      billingError('INVALID_ADMOB_REWARD', 400);
    const timestamp = Number(fields.timestamp);
    if (!Number.isSafeInteger(timestamp))
      billingError('INVALID_ADMOB_REWARD', 400);
    const initial = await this.db.rewardTicket.findUnique({
      where: { secretHash: androidHash(fields.custom_data) },
    });
    if (
      !initial ||
      initial.environment !== this.policy.environment ||
      initial.ssvUserId !== fields.user_id ||
      initial.ssvAdUnitId !== fields.ad_unit ||
      initial.rewardItem !== fields.reward_item ||
      timestamp < initial.issuedAt.getTime() - 60_000 ||
      timestamp > initial.expiresAt.getTime() + 60_000 ||
      timestamp > Date.now() + 60_000
    )
      billingError('INVALID_ADMOB_REWARD', 400);
    return this.db.$transaction(async (tx) => {
      await lockBillingUser(tx, initial.userId);
      const ticket = await tx.rewardTicket.findUniqueOrThrow({
        where: { id: initial.id },
      });
      const key = {
        provider: `ADMOB_${this.policy.environment.toUpperCase()}`,
        eventId: fields.transaction_id,
      };
      const event = await tx.rewardEvent.findUnique({
        where: { provider_eventId: key },
      });
      if (ticket.status === 'REDEEMED' || event) {
        if (
          ticket.transactionId !== fields.transaction_id ||
          event?.userId !== ticket.userId
        )
          billingError('REWARD_ALREADY_CLAIMED', 409);
        return { received: true };
      }
      await tx.rewardEvent.create({
        data: {
          ...key,
          userId: ticket.userId,
          amount: 1,
          verifiedAt: new Date(),
          metadata: {
            ticketId: ticket.id,
            earnedAt: new Date(timestamp).toISOString(),
            adUnitId: ticket.adUnitId,
          },
        },
      });
      await tx.quotaAccount.upsert({
        where: { userId: ticket.userId },
        create: { userId: ticket.userId, rewardBalance: 1 },
        update: { rewardBalance: { increment: 1 } },
      });
      await tx.rewardTicket.update({
        where: { id: ticket.id },
        data: {
          status: 'REDEEMED',
          transactionId: fields.transaction_id,
          redeemedAt: new Date(),
        },
      });
      return { received: true };
    });
  }
}
