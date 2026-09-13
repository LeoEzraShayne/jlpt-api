import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Client } from 'pg';

// Frozen review inventory: schema additions fail closed until classified.
export const schemaHash =
  'd1915d01fbfb520f3f7fc807b7362da6ba7e7d65d976ac8d5cf850b469a95e50';
type Action = 'DELETE' | 'TOMBSTONE' | 'RETAIN_SCRUB' | 'REVIEW' | 'SHARED';
type Rule = { action: Action; where: string; reason: string };
const owned = '"userId" = $1';
const rules: Record<string, Rule> = {};
function add(names: string, action: Action, where: string, reason: string) {
  for (const name of names.split(' ')) rules[name] = { action, where, reason };
}
add(
  'User',
  'TOMBSTONE',
  '"id" = $1',
  'Non-authenticating random profile; learning/auth rows explicitly deleted',
);
add(
  'AuthAccount AuthSession StudyPlan StudyTask UserGrammarProgress StudySession SentenceAttempt ReviewEvent DailyStudyStat StudyActivityDay VocabularyBookmark PersonalExpression ContentImport ContentCandidate ContentExposure VocabularyLearning VocabularyPractice',
  'DELETE',
  owned,
  'Account or learning data with User FK',
);
add(
  'VocabularyEntry',
  'DELETE',
  '"ownerId" = $1',
  'Private vocabulary; shared owner-null entries survive',
);
add(
  'ReviewSchedule',
  'DELETE',
  '"progressId" IN (SELECT id FROM "UserGrammarProgress" WHERE "userId" = $1)',
  'Indirect FK learning schedule',
);
add(
  'AiReviewJob',
  'DELETE',
  '"attemptId" IN (SELECT id FROM "SentenceAttempt" WHERE "userId" = $1)',
  'Queued/finished AI job; removal fences result writes; admitted network may finish detached costs',
);
add(
  'AiReviewResult',
  'DELETE',
  '"jobId" IN (SELECT j.id FROM "AiReviewJob" j JOIN "SentenceAttempt" a ON a.id=j."attemptId" WHERE a."userId" = $1)',
  'Corrections and free-text feedback',
);
add(
  'QuotaAccount QuotaPeriod TaskAuthorization TaskSubmission RewardEvent VocabularyPracticeAttempt AndroidBindingRequest AndroidSession RewardTicket',
  'DELETE',
  owned,
  'Scalar userId without User FK; explicit deletion required',
);
add(
  'PaymentOrder',
  'RETAIN_SCRUB',
  owned,
  'Proposed accounting minimum; original opaque ID currently required by Stripe verification',
);
add(
  'GooglePlayPurchase',
  'RETAIN_SCRUB',
  owned,
  'Encrypted token and anonymous subject/ledger link retained for refund reconciliation only',
);
add(
  'EntitlementGrant',
  'RETAIN_SCRUB',
  owned,
  'Revoke access and remove free-form metadata; financial source links retained',
);
add(
  'AiUsageRecord',
  'RETAIN_SCRUB',
  owned,
  'Detach user/task identifiers; retain provider/cost counters, clear raw usage',
);
add(
  'BillingEvent',
  'RETAIN_SCRUB',
  '"orderId" IN (SELECT id FROM "PaymentOrder" WHERE "userId"=$1) OR "googlePurchaseId" IN (SELECT id FROM "GooglePlayPurchase" WHERE "userId"=$1)',
  'Keep receipt deduplication and order links; remove payload',
);
add(
  'ImportBatch',
  'REVIEW',
  '"operatorId"=$1',
  'Admin dataset provenance and summary require manual scope review',
);
add(
  'ImportError',
  'REVIEW',
  '"batchId" IN (SELECT id FROM "ImportBatch" WHERE "operatorId"=$1)',
  'Import errors may contain personal text; shared import cannot be blindly deleted',
);
add(
  'GrammarPoint GrammarExample GrammarRelationGroup GrammarRelationMember ReviewAlgorithmProfile TrainingScenario AiProviderCircuit BillingConfig AndroidCommerceSyncState',
  'SHARED',
  'false',
  'Shared content/configuration has no account owner; preserve',
);
add(
  'ContentTranslation',
  'REVIEW',
  "\"entityType\" NOT IN ('GRAMMAR','EXAMPLE','RELATION','SCENARIO')",
  'Known types are shared curriculum; unknown entity types require review',
);

export async function tablePlan(sql: Client, userId: string) {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  if (createHash('sha256').update(schema).digest('hex') !== schemaHash)
    throw new Error('DELETION_SCHEMA_REVIEW_REQUIRED');
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]);
  if (
    models.length !== Object.keys(rules).length ||
    models.some((m) => !rules[m])
  )
    throw new Error('DELETION_TABLE_REVIEW_REQUIRED');
  const output = [];
  for (const table of models) {
    const rule = rules[table];
    const result = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM "${table}" WHERE ${rule.where}`,
      rule.where.includes('$1') ? [userId] : [],
    );
    output.push({ table, ...rule, count: result.rows[0].count });
  }
  return output;
}
