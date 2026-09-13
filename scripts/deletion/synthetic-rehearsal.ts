import { randomUUID } from 'node:crypto';
import {
  acceptanceDatabase,
  type AcceptanceDatabase,
} from '../../test/sentence-lab/database';
import { deleteAccount } from './operator';

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
  const account = await h.prisma.user.findUniqueOrThrow({
    where: { id: fixture.userId },
  });
  if (!account.deletedAt && account.email !== fixture.email)
    throw new Error('SYNTHETIC_ACCOUNT_REQUIRED');
  const preview = await deleteAccount(h.sql, fixture.userId);
  if (!options.applySynthetic) return preview;
  return deleteAccount(h.sql, fixture.userId, {
    apply: true,
    review: {
      ...syntheticReview(fixture.userId),
      planDigest: preview.planDigest,
    },
  });
}
export function syntheticReview(userId: string) {
  return {
    userId,
    requestRef: 'synthetic-only-request',
    ownershipVerified: true,
    scope: 'JLPT',
    retentionBasis: 'Synthetic fixture only; no real retention decision',
    nextRetentionReview: '2026-09-14',
    rightsEndAcknowledged: true,
    pendingPaymentHandling: 'MANUAL_REVIEW_NO_AUTO_REFUND',
  };
}
