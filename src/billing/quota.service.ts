import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Prisma, TaskAuthorization } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { TaskKind } from '../contracts/sentence-lab';
import { PrismaService } from '../database/prisma.service';
import { localDayBounds } from '../vocabulary-learning/vocabulary-learning.service';
import { billingError } from './billing.policy';
import { EntitlementService, lockBillingUser } from './entitlement.service';

export function submissionHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

@Injectable()
export class QuotaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  async period(tx: Prisma.TransactionClient, userId: string, now = new Date()) {
    const account = await tx.quotaAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    let period = account.currentPeriodId
      ? await tx.quotaPeriod.findUnique({
          where: { id: account.currentPeriodId },
        })
      : null;
    if (!period || now >= period.endsAt) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { timezone: true },
      });
      let endsAt = localDayBounds(user.timezone, now).lt;
      // A timezone transition may lengthen one period, never shorten it into an
      // extra issuance. Subsequent periods retain normal local/DST midnights.
      if (period && period.timezone !== user.timezone) {
        const minimumEnd = localDayBounds(period.timezone, now).lt;
        if (endsAt < minimumEnd)
          endsAt = localDayBounds(user.timezone, endsAt).lt;
      }
      period = await tx.quotaPeriod.create({
        data: { userId, timezone: user.timezone, startsAt: now, endsAt },
      });
      await tx.quotaAccount.update({
        where: { userId },
        data: { currentPeriodId: period.id },
      });
    }
    return { account, period };
  }

  async summary(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockBillingUser(tx, userId);
      const now = new Date();
      const membership = await this.entitlements.membership(tx, userId, now);
      const { account, period } = await this.period(tx, userId, now);
      const config = await tx.billingConfig.findUnique({
        where: { id: 'default' },
      });
      return {
        ...membership,
        expiresAt: membership.expiresAt?.toISOString() ?? null,
        salesEnabled: config?.salesEnabled ?? false,
        quota: {
          dailyLimit: period.dailyLimit,
          consumed: period.consumed,
          reserved: period.reserved,
          remaining: Math.max(
            0,
            period.dailyLimit - period.reserved - period.consumed,
          ),
          rewardBalance: account.rewardBalance - account.rewardReserved,
          resetsAt: period.endsAt.toISOString(),
          timezone: period.timezone,
          enforcementEnabled: config?.enforcementEnabled ?? false,
        },
      };
    });
  }

  async authorizeTask(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: TaskKind,
    taskKey: string,
  ) {
    await lockBillingUser(tx, userId);
    const now = new Date();
    await this.expireReservations(tx, userId, now);
    const config = await tx.billingConfig.findUnique({
      where: { id: 'default' },
    });
    let auth = await tx.taskAuthorization.findUnique({
      where: { kind_taskKey: { kind, taskKey } },
    });
    if (auth && auth.userId !== userId) billingError('IDEMPOTENCY_CONFLICT');
    if (auth?.source === 'EXEMPT') return auth;
    const member = await this.entitlements.membership(tx, userId, now);
    if (
      auth &&
      auth.status !== 'RELEASED' &&
      (auth.source !== 'MEMBER' || member.isMember)
    )
      return auth;
    const task =
      kind === 'GRAMMAR'
        ? await tx.studySession.findUniqueOrThrow({
            where: { id: taskKey },
            select: { userId: true, createdAt: true },
          })
        : await tx.vocabularyPractice.findUniqueOrThrow({
            where: { id: taskKey },
            select: { userId: true, createdAt: true },
          });
    if (task.userId !== userId) billingError('IDEMPOTENCY_CONFLICT');
    const exempt =
      !config?.enforcementEnabled ||
      !!(config.enforcementAt && task.createdAt < config.enforcementAt);
    const { account, period } = await this.period(tx, userId, now);
    let source = exempt ? 'EXEMPT' : member.isMember ? 'MEMBER' : 'DAILY';
    if (!exempt && !member.isMember) {
      if (period.consumed + period.reserved < period.dailyLimit)
        await tx.quotaPeriod.update({
          where: { id: period.id },
          data: { reserved: { increment: 1 } },
        });
      else if (account.rewardBalance > account.rewardReserved) {
        source = 'REWARD';
        await tx.quotaAccount.update({
          where: { userId },
          data: { rewardReserved: { increment: 1 } },
        });
      } else billingError('DAILY_TASK_LIMIT', 402);
    }
    const data = {
      source,
      periodId: source === 'DAILY' ? period.id : null,
      status: 'RESERVED',
      releasedAt: null,
      expiresAt: new Date(now.getTime() + 24 * 3600_000),
    };
    auth = auth
      ? await tx.taskAuthorization.update({ where: { id: auth.id }, data })
      : await tx.taskAuthorization.create({
          data: { ...data, userId, kind, taskKey },
        });
    return auth;
  }

  async authorizeSubmission(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: TaskKind,
    taskKey: string,
    requestKey: string,
    payloadHash?: string,
  ) {
    await lockBillingUser(tx, userId);
    const existingAuth = await tx.taskAuthorization.findUnique({
      where: { kind_taskKey: { kind, taskKey } },
    });
    if (existingAuth && existingAuth.userId !== userId)
      billingError('IDEMPOTENCY_CONFLICT');
    const existing = existingAuth
      ? await tx.taskSubmission.findUnique({
          where: {
            authorizationId_requestKey: {
              authorizationId: existingAuth.id,
              requestKey,
            },
          },
        })
      : null;
    if (existing && existing.userId !== userId)
      billingError('IDEMPOTENCY_CONFLICT');
    if (existing && existing.payloadHash !== (payloadHash ?? null))
      billingError('IDEMPOTENCY_CONFLICT');
    if (existing && existing.status !== 'FAILED') return existing;
    const member = await this.entitlements.membership(tx, userId);
    const enforced = (
      await tx.billingConfig.findUnique({ where: { id: 'default' } })
    )?.enforcementEnabled;
    if (
      enforced &&
      existingAuth &&
      existingAuth.source !== 'EXEMPT' &&
      !member.isMember &&
      existingAuth.successfulReviews + existingAuth.reservedReviews >= 3
    )
      billingError('TASK_REVIEW_LIMIT', 402);
    const auth = await this.authorizeTask(tx, userId, kind, taskKey);
    if (
      enforced &&
      auth.source !== 'EXEMPT' &&
      !member.isMember &&
      auth.successfulReviews + auth.reservedReviews >= 3
    )
      billingError('TASK_REVIEW_LIMIT', 402);
    await tx.taskAuthorization.update({
      where: { id: auth.id },
      data: { reservedReviews: { increment: 1 } },
    });
    return existing
      ? tx.taskSubmission.update({
          where: { id: existing.id },
          data: { status: 'PENDING', completedAt: null },
        })
      : tx.taskSubmission.create({
          data: { authorizationId: auth.id, userId, requestKey, payloadHash },
        });
  }

  async completeSubmission(
    tx: Prisma.TransactionClient,
    submissionId: string,
    resultId?: string,
  ) {
    const initial = await tx.taskSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    await lockBillingUser(tx, initial.userId);
    const sub = await tx.taskSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    if (sub.status !== 'PENDING') return;
    const auth = await tx.taskAuthorization.findUniqueOrThrow({
      where: { id: sub.authorizationId },
    });
    if (auth.status === 'RESERVED') {
      if (auth.source === 'DAILY')
        await tx.quotaPeriod.update({
          where: { id: auth.periodId! },
          data: { reserved: { decrement: 1 }, consumed: { increment: 1 } },
        });
      if (auth.source === 'REWARD')
        await tx.quotaAccount.update({
          where: { userId: auth.userId },
          data: {
            rewardReserved: { decrement: 1 },
            rewardBalance: { decrement: 1 },
          },
        });
    }
    await tx.taskAuthorization.update({
      where: { id: auth.id },
      data: {
        status: 'CONSUMED',
        consumedAt: auth.consumedAt ?? new Date(),
        successfulReviews: { increment: 1 },
        reservedReviews: { decrement: 1 },
      },
    });
    await tx.taskSubmission.update({
      where: { id: sub.id },
      data: {
        status: 'SUCCEEDED',
        resultId: resultId ?? sub.resultId,
        completedAt: new Date(),
      },
    });
  }

  async failSubmission(tx: Prisma.TransactionClient, submissionId: string) {
    const initial = await tx.taskSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    await lockBillingUser(tx, initial.userId);
    const sub = await tx.taskSubmission.findUniqueOrThrow({
      where: { id: submissionId },
    });
    if (sub.status !== 'PENDING') return;
    const auth = await tx.taskAuthorization.update({
      where: { id: sub.authorizationId },
      data: { reservedReviews: { decrement: 1 } },
    });
    await tx.taskSubmission.update({
      where: { id: sub.id },
      data: { status: 'FAILED' },
    });
    if (!auth.reservedReviews) await this.release(tx, auth);
  }

  async releaseTask(
    tx: Prisma.TransactionClient,
    userId: string,
    kind: TaskKind,
    taskKey: string,
  ) {
    await lockBillingUser(tx, userId);
    const auth = await tx.taskAuthorization.findUnique({
      where: { kind_taskKey: { kind, taskKey } },
    });
    if (auth?.userId === userId && !auth.reservedReviews)
      await this.release(tx, auth);
  }
  private async expireReservations(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ) {
    const expired = await tx.taskAuthorization.findMany({
      where: {
        userId,
        status: 'RESERVED',
        reservedReviews: 0,
        expiresAt: { lte: now },
      },
    });
    for (const auth of expired) {
      if (auth.kind === 'VOCABULARY') {
        const active = await tx.vocabularyPractice.findFirst({
          where: {
            id: auth.taskKey,
            status: { in: ['QUEUED', 'GENERATING', 'ASSESSING'] },
          },
        });
        if (active) continue;
      }
      await this.release(tx, auth);
    }
  }

  @Interval(60_000)
  async reconcileReservations() {
    try {
      const candidates = await this.prisma.taskAuthorization.findMany({
        where: {
          OR: [
            { status: 'RESERVED', expiresAt: { lte: new Date() } },
            { reservedReviews: { gt: 0 } },
          ],
        },
        take: 100,
        orderBy: { updatedAt: 'asc' },
      });
      for (const auth of candidates)
        await this.prisma.$transaction(async (tx) => {
          await lockBillingUser(tx, auth.userId);
          const pending = await tx.taskSubmission.findMany({
            where: { authorizationId: auth.id, status: 'PENDING' },
          });
          for (const sub of pending) {
            const failed =
              auth.kind === 'GRAMMAR'
                ? !!(await tx.aiReviewJob.findFirst({
                    where: { id: sub.resultId ?? '', status: 'FAILED' },
                  }))
                : !!(await tx.vocabularyPractice.findFirst({
                    where: { id: auth.taskKey, status: 'FAILED' },
                  }));
            if (failed) {
              await this.failSubmission(tx, sub.id);
              if (auth.kind === 'VOCABULARY')
                await tx.vocabularyPracticeAttempt.updateMany({
                  where: { submissionId: sub.id, status: 'QUEUED' },
                  data: { status: 'FAILED', errorCode: 'JOB_FAILED' },
                });
            }
          }
          await this.expireReservations(tx, auth.userId, new Date());
        });
    } catch {
      new Logger(QuotaService.name).error('Quota reconciliation failed');
    }
  }

  private async release(tx: Prisma.TransactionClient, auth: TaskAuthorization) {
    if (auth.status !== 'RESERVED') return;
    if (auth.source === 'DAILY')
      await tx.quotaPeriod.update({
        where: { id: auth.periodId! },
        data: { reserved: { decrement: 1 } },
      });
    if (auth.source === 'REWARD')
      await tx.quotaAccount.update({
        where: { userId: auth.userId },
        data: { rewardReserved: { decrement: 1 } },
      });
    await tx.taskAuthorization.update({
      where: { id: auth.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  }
}
