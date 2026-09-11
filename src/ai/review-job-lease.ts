import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';

export interface ReviewLease {
  id: string;
  lockedAt: Date;
}
// All provider calls (including response bodies) finish within 40s, with fallback.
// A two-minute lease recovers interrupted workers. Timestamps use UTC because
// Prisma DateTime columns are timestamp-without-time-zone, even on a UTC+8 DB.
export async function claimReview(prisma: PrismaService) {
  const now = Prisma.sql`date_trunc('milliseconds', NOW() AT TIME ZONE 'UTC')`;
  const rows = await prisma.$queryRaw<ReviewLease[]>(Prisma.sql`
      UPDATE "AiReviewJob" SET status='PROCESSING', "lockedAt"=${now}, "updatedAt"=${now}
      WHERE id=(SELECT id FROM "AiReviewJob" WHERE
        (status='QUEUED' AND "availableAt"<=${now}) OR
        (status='PROCESSING' AND ("lockedAt"<${now}-interval '2 minutes' OR
          "lockedAt">${now}+interval '1 minute'))
        ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, "lockedAt"`);
  return rows[0];
}

export const leaseWhere = (lease: ReviewLease) => ({
  id: lease.id,
  status: 'PROCESSING' as const,
  lockedAt: lease.lockedAt,
});
