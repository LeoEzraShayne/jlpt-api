import { Prisma } from '@prisma/client';
import type { PrismaService } from '../database/prisma.service';
import { MAX_ATTEMPTS } from './vocabulary-learning.policy';

export interface VocabularyLease {
  id: string;
  status: string;
  lockedAt: Date;
  attempts: number;
}

export async function claimVocabularyPractice(prisma: PrismaService) {
  // DateTime columns contain UTC without a timezone. Match the existing provider worker.
  const now = Prisma.sql`date_trunc('milliseconds', NOW() AT TIME ZONE 'UTC')`;
  const expired = Prisma.sql`("lockedAt" IS NULL OR "lockedAt" < ${now} - interval '2 minutes'
    OR "lockedAt" > ${now} + interval '1 minute')`;
  // A process dying on its final attempt must not leave a permanently locked job.
  await prisma.$executeRaw(Prisma.sql`UPDATE "VocabularyPractice"
    SET status='FAILED', "errorCode"='RETRY_LIMIT', "lockedAt"=NULL, "updatedAt"=${now}
    WHERE status IN ('GENERATING','ASSESSING') AND attempts >= ${MAX_ATTEMPTS} AND ${expired}`);
  const rows = await prisma.$queryRaw<VocabularyLease[]>(Prisma.sql`
    UPDATE "VocabularyPractice" SET
      status=CASE WHEN answer IS NULL THEN 'GENERATING' ELSE 'ASSESSING' END,
      "lockedAt"=${now}, "updatedAt"=${now}, attempts=attempts+1
    WHERE id=(SELECT id FROM "VocabularyPractice" WHERE attempts < ${MAX_ATTEMPTS} AND (
      (status='QUEUED' AND "availableAt" <= ${now}) OR
      (status IN ('GENERATING','ASSESSING') AND "availableAt" <= ${now} AND ${expired})
    ) ORDER BY "availableAt", "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING id, status, "lockedAt", attempts`);
  return rows[0];
}

export function vocabularyLeaseWhere(lease: VocabularyLease) {
  return {
    id: lease.id,
    status: lease.status,
    lockedAt: lease.lockedAt,
    attempts: lease.attempts,
  };
}
