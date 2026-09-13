import { randomUUID } from 'node:crypto';
import {
  acceptanceDatabase,
  type AcceptanceDatabase,
} from '../../test/sentence-lab/database';
import { tablePlan } from './table-plan';

// No DATABASE_URL, dotenv, existing DB selector, email selector or production apply.
// Only handles minted here for a freshly created DB can reach the mutating path.
const fixtures = new WeakMap<
  AcceptanceDatabase,
  { userId: string; email: string }
>();
export async function createDeletionFixture() {
  const h = await acceptanceDatabase();
  try {
    const user = await h.prisma.user.create({
      data: {
        email: `deletion-${randomUUID()}@example.test`,
        displayName: 'Synthetic deletion only',
        googlePlayAccountId: randomUUID(),
      },
    });
    fixtures.set(h, { userId: user.id, email: user.email });
    await h.prisma.authAccount.create({
      data: {
        userId: user.id,
        provider: 'google',
        providerAccountId: randomUUID(),
      },
    });
    const session = await h.prisma.authSession.create({
      data: {
        userId: user.id,
        tokenHash: randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await h.prisma.androidSession.create({
      data: {
        userId: user.id,
        sourceSessionId: session.id,
        tokenHash: randomUUID(),
        clientId: 'synthetic',
        expiresAt: session.expiresAt,
      },
    });
    await h.prisma.androidBindingRequest.create({
      data: {
        userId: user.id,
        sourceSessionId: session.id,
        codeChallenge: 'synthetic',
        state: 'synthetic',
        clientId: 'synthetic',
        expiresAt: session.expiresAt,
      },
    });
    const grammar = await h.prisma.grammarPoint.create({
      data: {
        level: 'N4',
        title: 'Synthetic shared grammar',
        chineseExplanation: 'fixture',
        sortOrder: 1,
        sourceDataset: 'deletion-fixture',
        sourceOrdinal: 1,
        sourceHash: 'synthetic',
      },
    });
    const study = await h.prisma.studySession.create({
      data: {
        userId: user.id,
        grammarId: grammar.id,
        mode: 'PRACTICE',
        timerPhaseEndsAt: new Date(),
        trainingContext: { text: 'synthetic personal context' },
      },
    });
    const attempt = await h.prisma.sentenceAttempt.create({
      data: {
        userId: user.id,
        grammarId: grammar.id,
        studySessionId: study.id,
        source: 'FREE_PRACTICE',
        sentence: '合成データです。',
      },
    });
    await h.prisma.aiReviewJob.create({ data: { attemptId: attempt.id } });
    const word = await h.prisma.vocabularyEntry.create({
      data: {
        ownerId: user.id,
        fingerprint: randomUUID(),
        word: '合成',
        reading: 'ごうせい',
        senseKey: 'fixture',
        glosses: [],
        sourceName: 'synthetic',
        sourceVersion: '1',
        provenance: { text: 'synthetic private import' },
      },
    });
    const learning = await h.prisma.vocabularyLearning.create({
      data: { userId: user.id, vocabularyId: word.id },
    });
    const practice = await h.prisma.vocabularyPractice.create({
      data: {
        userId: user.id,
        vocabularyId: word.id,
        learningId: learning.id,
        learningRevision: 0,
        unknownAtStart: true,
        dueAtStart: false,
      },
    });
    await h.prisma.vocabularyPracticeAttempt.create({
      data: {
        userId: user.id,
        practiceId: practice.id,
        ordinal: 1,
        requestKey: randomUUID(),
        answer: 'synthetic answer',
      },
    });
    await h.prisma.quotaAccount.create({
      data: { userId: user.id, rewardBalance: 2 },
    });
    const period = await h.prisma.quotaPeriod.create({
      data: {
        userId: user.id,
        timezone: 'Asia/Tokyo',
        startsAt: new Date(),
        endsAt: session.expiresAt,
      },
    });
    const authorization = await h.prisma.taskAuthorization.create({
      data: {
        userId: user.id,
        kind: 'GRAMMAR',
        taskKey: study.id,
        periodId: period.id,
        source: 'FREE',
      },
    });
    await h.prisma.taskSubmission.create({
      data: {
        userId: user.id,
        authorizationId: authorization.id,
        requestKey: randomUUID(),
      },
    });
    await h.prisma.rewardTicket.create({
      data: {
        userId: user.id,
        environment: 'test',
        requestKey: randomUUID(),
        secretHash: randomUUID(),
        ssvUserId: randomUUID(),
        adUnitId: 'synthetic',
        ssvAdUnitId: 'synthetic',
        rewardItem: 'task',
        expiresAt: session.expiresAt,
      },
    });
    await h.prisma.rewardEvent.create({
      data: {
        userId: user.id,
        provider: 'ADMOB_TEST',
        eventId: randomUUID(),
        verifiedAt: new Date(),
      },
    });
    const order = await h.prisma.paymentOrder.create({
      data: {
        userId: user.id,
        provider: 'STRIPE',
        environment: 'test',
        productCode: 'DAY_PASS',
        market: 'GLOBAL',
        currency: 'USD',
        amount: 99,
        durationSeconds: 86400,
        requestKey: randomUUID(),
        snapshot: { sensitiveFixture: user.email },
        checkoutUrl: 'https://example.test/synthetic-checkout',
      },
    });
    await h.prisma.entitlementGrant.create({
      data: {
        userId: user.id,
        sourceKey: `order:${order.id}`,
        orderId: order.id,
        source: 'STRIPE_TEST',
        durationSeconds: 86400,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86400_000),
        metadata: { sensitiveFixture: user.email },
      },
    });
    await h.prisma.billingEvent.create({
      data: {
        provider: 'STRIPE',
        environment: 'test',
        eventId: randomUUID(),
        eventType: 'synthetic',
        orderId: order.id,
        payload: { sensitiveFixture: user.email },
      },
    });
    await h.prisma.aiUsageRecord.create({
      data: {
        userId: user.id,
        taskKind: 'GRAMMAR',
        taskKey: study.id,
        requestId: randomUUID(),
        provider: 'DEEPSEEK',
        purpose: 'GRAMMAR_REVIEW',
        model: 'synthetic',
        success: true,
        latencyMs: 1,
        costUsd: '0.0001',
        rawUsage: { sensitiveFixture: user.email },
      },
    });
    return { h, user, grammar, order, study };
  } catch (error) {
    await h.stop();
    throw error;
  }
}

export async function rehearseDeletion(
  h: AcceptanceDatabase,
  options: { applySynthetic?: boolean } = {},
) {
  const fixture = fixtures.get(h);
  if (!fixture) throw new Error('FRESH_SYNTHETIC_DATABASE_REQUIRED');
  const url = new URL(h.connectionString);
  const current = await h.sql.query<{ name: string }>(
    'SELECT current_database() AS name',
  );
  if (
    !/^\/jlpt_f_acceptance_test_\d+_[a-f0-9]{10}$/.test(url.pathname) ||
    current.rows[0].name !== url.pathname.slice(1)
  )
    throw new Error('FRESH_SYNTHETIC_DATABASE_REQUIRED');
  await h.sql.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await h.sql.query("SET LOCAL lock_timeout='2s'");
    await h.sql.query("SET LOCAL statement_timeout='10s'");
    const account = await h.sql.query<{ email: string }>(
      'SELECT email FROM "User" WHERE id=$1 FOR UPDATE',
      [fixture.userId],
    );
    if (account.rows.length !== 1 || account.rows[0].email !== fixture.email)
      throw new Error('SYNTHETIC_ACCOUNT_REQUIRED');
    const plan = await tablePlan(h.sql, fixture.userId);
    const busy = await h.sql.query<{ count: number }>(
      `SELECT (
      (SELECT count(*) FROM "AiReviewJob" j JOIN "SentenceAttempt" a ON a.id=j."attemptId" WHERE a."userId"=$1 AND j.status='PROCESSING') +
      (SELECT count(*) FROM "VocabularyPractice" WHERE "userId"=$1 AND "lockedAt" IS NOT NULL) +
      (SELECT count(*) FROM "AiUsageRecord" WHERE "userId"=$1 AND "errorCode"='AI_IN_FLIGHT') +
      (SELECT count(*) FROM "GooglePlayPurchase" WHERE "userId"=$1 AND "leaseUntil">CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    )::int AS count`,
      [fixture.userId],
    );
    const blockers = [
      ...plan
        .filter((p) => p.action === 'REVIEW' && p.count)
        .map((p) => `MANUAL_REVIEW:${p.table}`),
      ...(busy.rows[0].count ? ['IN_FLIGHT_WORK_REQUIRES_DRAIN'] : []),
    ];
    const exceptional = await h.sql.query<{ count: number }>(
      `SELECT (
      (SELECT count(*) FROM "EntitlementGrant" WHERE "userId"=$1 AND source='LAUNCH_GIFT') +
      (SELECT count(*) FROM "VocabularyLearning" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1)) +
      (SELECT count(*) FROM "VocabularyPractice" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1)) +
      (SELECT count(*) FROM "VocabularyBookmark" WHERE "userId"<>$1 AND "vocabularyId" IN (SELECT id FROM "VocabularyEntry" WHERE "ownerId"=$1))
    )::int AS count`,
      [fixture.userId],
    );
    if (exceptional.rows[0].count)
      blockers.push('GIFT_OR_CROSS_ACCOUNT_SCOPE_REQUIRES_REVIEW');
    const report = {
      mode: options.applySynthetic ? 'SYNTHETIC_APPLY' : 'DRY_RUN',
      productionReady: false,
      productionBlockers: [
        'STRIPE_ORPHAN_GRANT',
        'GOOGLE_DELETED_OWNER_REFUND',
        'AI_LATE_USER_RELINK',
        'RETENTION_AND_OPERATOR_APPROVAL_REQUIRED',
      ],
      blockers,
      plan: plan.map(({ table, action, reason, count }) => ({
        table,
        action,
        reason,
        count,
      })),
    };
    if (!options.applySynthetic) {
      await h.sql.query('ROLLBACK');
      return report;
    }
    if (blockers.length)
      throw new Error(`DELETION_BLOCKED:${blockers.join(',')}`);
    // Simulation only. Financial identifiers intentionally remain, NOT anonymized.
    await h.sql.query(
      'UPDATE "PaymentOrder" SET "checkoutUrl"=NULL, snapshot=\'{}\'::jsonb, "requestKey"=\'deleted:\'||id WHERE "userId"=$1',
      [fixture.userId],
    );
    await h.sql.query(
      'UPDATE "BillingEvent" SET payload=\'{}\'::jsonb WHERE "orderId" IN (SELECT id FROM "PaymentOrder" WHERE "userId"=$1) OR "googlePurchaseId" IN (SELECT id FROM "GooglePlayPurchase" WHERE "userId"=$1)',
      [fixture.userId],
    );
    await h.sql.query(
      'UPDATE "EntitlementGrant" SET status=\'REVOKED\', "revokedAt"=CURRENT_TIMESTAMP AT TIME ZONE \'UTC\', metadata=NULL WHERE "userId"=$1',
      [fixture.userId],
    );
    await h.sql.query(
      'UPDATE "GooglePlayPurchase" SET evidence=NULL, revision=revision+1, "leaseToken"=NULL, "leaseUntil"=NULL WHERE "userId"=$1',
      [fixture.userId],
    );
    await h.sql.query(
      'UPDATE "AiUsageRecord" SET "userId"=NULL, "taskKey"=NULL, "taskKind"=NULL, "rawUsage"=NULL WHERE "userId"=$1',
      [fixture.userId],
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
      await h.sql.query(`DELETE FROM "${table}" WHERE "userId"=$1`, [
        fixture.userId,
      ]);
    await h.sql.query('DELETE FROM "User" WHERE id=$1', [fixture.userId]);
    await h.sql.query('COMMIT');
    return report;
  } catch (error) {
    await h.sql.query('ROLLBACK');
    throw error;
  }
}
