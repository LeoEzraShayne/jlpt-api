import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

export interface ReviewLease {
  id: string;
  lockedAt: Date;
  exhausted: boolean;
  round: number;
}
export const AUTOMATIC_REVIEW_ROUNDS = 3;
export const TOTAL_REVIEW_ROUNDS = 4; // Includes the existing explicit manual recovery.
// All provider calls (including response bodies) finish within 40s, with fallback.
// A two-minute lease recovers interrupted workers. Timestamps use UTC because
// Prisma DateTime columns are timestamp-without-time-zone, even on a UTC+8 DB.
export async function claimReview(prisma: PrismaService) {
  const now = Prisma.sql`date_trunc('milliseconds', NOW() AT TIME ZONE 'UTC')`;
  const rows = await prisma.$queryRaw<ReviewLease[]>(Prisma.sql`
      WITH candidate AS (SELECT id, status, "retryCount" FROM "AiReviewJob" WHERE
        (status='QUEUED' AND "availableAt"<=${now}) OR
        (status='PROCESSING' AND ("lockedAt"<${now}-interval '2 minutes' OR
          "lockedAt">${now}+interval '1 minute'))
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1),
      admission AS (SELECT *, ("retryCount">=${TOTAL_REVIEW_ROUNDS} OR
        (status='PROCESSING' AND "retryCount">=${AUTOMATIC_REVIEW_ROUNDS})) AS exhausted
        FROM candidate)
      UPDATE "AiReviewJob" job SET status='PROCESSING', "lockedAt"=${now}, "updatedAt"=${now},
        "retryCount"=admission."retryCount" + CASE WHEN admission.exhausted THEN 0 ELSE 1 END
      FROM admission WHERE job.id=admission.id
      RETURNING job.id, job."lockedAt", admission.exhausted, job."retryCount" AS round`);
  return rows[0];
}

export const leaseWhere = (lease: ReviewLease) => ({
  id: lease.id,
  status: 'PROCESSING' as const,
  lockedAt: lease.lockedAt,
});
