import { createHash, randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { z } from 'zod';
import { tablePlan } from './table-plan';

export const deletionReview = z
  .object({
    userId: z.string().min(1),
    requestRef: z.string().min(8).max(100),
    ownershipVerified: z.literal(true),
    scope: z.literal('JLPT'),
    retentionBasis: z.string().min(12).max(2000),
    nextRetentionReview: z.string().regex(/^\d{4}-\d\d-\d\d$/),
    rightsEndAcknowledged: z.literal(true),
    pendingPaymentHandling: z.literal('MANUAL_REVIEW_NO_AUTO_REFUND'),
    planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DeletionReview = z.infer<typeof deletionReview>;
export interface DeletionReport {
  mode: string;
  completedAt?: Date;
  productionReady: boolean;
  plan: Array<{ table: string; action: string; reason: string; count: number }>;
  blockers: string[];
  admittedWorkCount: number;
  planDigest: string;
  productionBlockers?: string[];
}
/** Caller chooses a DB explicitly. This module never loads credentials or sends mail. */
export async function deleteAccount(
  sql: Client,
  userId: string,
  options: { apply?: boolean; review?: unknown } = {},
): Promise<DeletionReport> {
  if (options.apply) {
    const review = deletionReview.parse(options.review);
    if (review.userId !== userId) throw new Error('REVIEW_ACCOUNT_MISMATCH');
  }
  // After waiting for the User lock, counts must see commits from its previous
  // holder. REPEATABLE READ could retain a pre-wait snapshot and miss a grant.
  await sql.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  try {
    await sql.query("SET LOCAL lock_timeout='2s'");
    await sql.query("SET LOCAL statement_timeout='10s'");
    const account = await sql.query<{ deletedAt: Date | null }>(
      'SELECT "deletedAt" AT TIME ZONE \'UTC\' AS "deletedAt" FROM "User" WHERE id=$1 FOR UPDATE',
      [userId],
    );
    if (account.rows.length !== 1) throw new Error('ACCOUNT_NOT_FOUND');
    const plan = await tablePlan(sql, userId);
    if (account.rows[0].deletedAt) {
      await sql.query('ROLLBACK');
      return {
        mode: 'ALREADY_DELETED',
        completedAt: account.rows[0].deletedAt,
        productionReady: false,
        plan: [],
        blockers: [],
        admittedWorkCount: 0,
        planDigest: '0'.repeat(64),
      };
    }
    const planDigest = createHash('sha256')
      .update(JSON.stringify([userId, plan]))
      .digest('hex');
    if (
      options.apply &&
      deletionReview.parse(options.review).planDigest !== planDigest
    )
      throw new Error('DELETION_PLAN_CHANGED_REVIEW_AGAIN');
    const busy = await sql.query<{ count: number }>(
      `SELECT (
      (SELECT count(*) FROM "AiReviewJob" j JOIN "SentenceAttempt" a ON a.id=j."attemptId" WHERE a."userId"=$1 AND j.status='PROCESSING') +
      (SELECT count(*) FROM "VocabularyPractice" WHERE "userId"=$1 AND "lockedAt" IS NOT NULL) +
      (SELECT count(*) FROM "AiUsageRecord" WHERE "userId"=$1 AND "errorCode"='AI_IN_FLIGHT') +
      (SELECT count(*) FROM "GooglePlayPurchase" WHERE "userId"=$1 AND "leaseUntil">CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    )::int AS count`,
      [userId],
    );
    const blockers = [
      ...plan
        .filter((p) => p.action === 'REVIEW' && p.count)
        .map((p) => `MANUAL_REVIEW:${p.table}`),
    ];
    const exceptional = await sql.query<{ count: number }>(
      `SELECT (
      (SELECT count(*) FROM "EntitlementGrant" WHERE "userId"=$1 AND source='LAUNCH_GIFT') +
      (SELECT count(*) FROM "VocabularyLearning" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1)) +
      (SELECT count(*) FROM "VocabularyPractice" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1)) +
      (SELECT count(*) FROM "VocabularyBookmark" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1))
    )::int AS count`,
      [userId],
    );
    if (exceptional.rows[0].count)
      blockers.push('GIFT_OR_CROSS_ACCOUNT_SCOPE_REQUIRES_REVIEW');
    const report: DeletionReport = {
      mode: options.apply ? 'APPLIED' : 'DRY_RUN',
      admittedWorkCount: busy.rows[0].count,
      productionReady: false,
      planDigest,
      productionBlockers: ['RETENTION_AND_OPERATOR_APPROVAL_REQUIRED'],
      blockers,
      plan: plan.map(({ table, action, reason, count }) => ({
        table,
        action,
        reason,
        count,
      })),
    };
    if (!options.apply) {
      await sql.query('ROLLBACK');
      return report;
    }
    if (blockers.length)
      throw new Error(`DELETION_BLOCKED:${blockers.join(',')}`);
    // Retention is request-specific and reviewed; financial IDs are pseudonymous.
    const marked = await sql.query<{ deletedAt: Date }>(
      `UPDATE "User" SET "deletedAt"=CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      email=$2, "displayName"='Deleted account', "avatarUrl"=NULL, role='USER',
      timezone='UTC', "targetLevel"='N1', "dailyMinutes"=30, "primaryShare"=80,
      "uiLocale"='zh', "explanationLocale"='zh', "learningV2Enabled"=false,
      "colorTheme"='sunshine', "createdAt"=CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
      "updatedAt"=CURRENT_TIMESTAMP AT TIME ZONE 'UTC' WHERE id=$1
      RETURNING "deletedAt" AT TIME ZONE 'UTC' AS "deletedAt"`,
      [userId, `${randomUUID()}@deleted.invalid`],
    );
    report.completedAt = marked.rows[0].deletedAt;
    await sql.query(
      'UPDATE "PaymentOrder" SET "checkoutUrl"=NULL, snapshot=\'{}\'::jsonb, "requestKey"=\'deleted:\'||id WHERE "userId"=$1',
      [userId],
    );
    await sql.query(
      'UPDATE "BillingEvent" SET payload=\'{}\'::jsonb WHERE "orderId" IN (SELECT id FROM "PaymentOrder" WHERE "userId"=$1) OR "googlePurchaseId" IN (SELECT id FROM "GooglePlayPurchase" WHERE "userId"=$1)',
      [userId],
    );
    await sql.query(
      'UPDATE "EntitlementGrant" SET status=\'REVOKED\', "revokedAt"=CURRENT_TIMESTAMP AT TIME ZONE \'UTC\', metadata=NULL WHERE "userId"=$1',
      [userId],
    );
    await sql.query(
      'UPDATE "GooglePlayPurchase" SET evidence=NULL, revision=revision+1, "leaseToken"=NULL, "leaseUntil"=NULL WHERE "userId"=$1',
      [userId],
    );
    await sql.query(
      'UPDATE "AiUsageRecord" SET "userId"=NULL, "taskKey"=NULL, "taskKind"=NULL, "rawUsage"=NULL WHERE "userId"=$1',
      [userId],
    );
    for (const table of [
      'AndroidSession',
      'AndroidBindingRequest',
      'RewardTicket',
      'RewardEvent',
      'TaskSubmission',
      'TaskAuthorization',
      'QuotaPeriod',
      'QuotaAccount',
      'VocabularyPracticeAttempt',
    ])
      await sql.query(`DELETE FROM "${table}" WHERE "userId"=$1`, [userId]);
    // Delete dependants before parents with ON DELETE SET NULL actions.
    for (const table of [
      'AuthAccount',
      'AuthSession',
      'ReviewEvent',
      'StudyActivityDay',
      'VocabularyPractice',
      'SentenceAttempt',
      'StudySession',
      'StudyTask',
      'StudyPlan',
      'UserGrammarProgress',
      'DailyStudyStat',
      'VocabularyBookmark',
      'VocabularyLearning',
      'PersonalExpression',
      'ContentCandidate',
      'ContentImport',
      'ContentExposure',
    ])
      await sql.query(`DELETE FROM "${table}" WHERE "userId"=$1`, [userId]);
    await sql.query('DELETE FROM "VocabularyEntry" WHERE "ownerId"=$1', [
      userId,
    ]);
    await sql.query('COMMIT');
    return report;
  } catch (error) {
    await sql.query('ROLLBACK');
    throw error;
  }
}
