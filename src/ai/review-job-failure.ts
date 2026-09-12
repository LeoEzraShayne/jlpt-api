import { AiJobStatus, type Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import type { QuotaService } from '../billing/quota.service';
import { lockBillingUser } from '../billing/entitlement.service';
import { ProviderError } from './ai-provider';
import {
  AUTOMATIC_REVIEW_ROUNDS,
  leaseWhere,
  type ReviewLease,
} from './review-job-lease';

export async function failReview(
  prisma: PrismaService,
  lease: ReviewLease,
  admittedRounds: number,
  error: unknown,
  quota?: QuotaService,
) {
  const failure =
    error instanceof ProviderError
      ? error
      : new ProviderError(
          'Unexpected AI worker error',
          'AI_INTERNAL_ERROR',
          true,
        );
  const retry =
    failure.retryable &&
    !lease.exhausted &&
    admittedRounds < AUTOMATIC_REVIEW_ROUNDS;
  const update = (tx: Prisma.TransactionClient | PrismaService) =>
    tx.aiReviewJob.updateMany({
      where: leaseWhere(lease),
      data: {
        status: retry ? AiJobStatus.QUEUED : AiJobStatus.FAILED,
        errorCode: failure.code,
        errorMessage: failure.message.slice(0, 500),
        availableAt: retry
          ? new Date(Date.now() + admittedRounds * 30_000)
          : new Date(),
        lockedAt: null,
      },
    });
  if (!quota) {
    await update(prisma);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const job = await tx.aiReviewJob.findUniqueOrThrow({
      where: { id: lease.id },
      include: { attempt: true },
    });
    await lockBillingUser(tx, job.attempt.userId);
    const saved = await update(tx);
    if (saved.count && !retry) {
      const submission = await tx.taskSubmission.findFirst({
        where: { resultId: lease.id, status: 'PENDING' },
      });
      if (submission) await quota.failSubmission(tx, submission.id);
    }
  });
}
