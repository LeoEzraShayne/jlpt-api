-- AlterTable
ALTER TABLE "User" ADD COLUMN     "explanationLocale" TEXT NOT NULL DEFAULT 'zh',
ADD COLUMN     "uiLocale" TEXT NOT NULL DEFAULT 'zh';

-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN     "explanationLocale" TEXT NOT NULL DEFAULT 'zh';

-- AlterTable
ALTER TABLE "AiReviewResult" ADD COLUMN     "explanationLocale" TEXT NOT NULL DEFAULT 'zh',
ADD COLUMN     "localizedFeedback" JSONB;

-- AlterTable
ALTER TABLE "VocabularyPractice" ADD COLUMN     "explanationLocale" TEXT NOT NULL DEFAULT 'zh';

-- CreateTable
CREATE TABLE "BillingConfig" (
    "enforcementAt" TIMESTAMP(3),
    "id" TEXT NOT NULL DEFAULT 'default',
    "launchAt" TIMESTAMP(3),
    "salesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enforcementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "rewardsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'test',
    "productCode" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "launchPrice" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestKey" TEXT NOT NULL,
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "refundedAmount" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntitlementGrant" (
    "consumedSeconds" INTEGER NOT NULL DEFAULT 0,
    "remainingSeconds" INTEGER,
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "orderId" TEXT,
    "source" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "revokedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "providerCreatedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "orderId" TEXT,
    "payload" JSONB NOT NULL,
    "errorCode" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaAccount" (
    "userId" TEXT NOT NULL,
    "currentPeriodId" TEXT,
    "rewardBalance" INTEGER NOT NULL DEFAULT 0,
    "rewardReserved" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuotaAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "QuotaPeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 5,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "consumed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAuthorization" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "periodId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "successfulReviews" INTEGER NOT NULL DEFAULT 0,
    "reservedReviews" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskSubmission" (
    "id" TEXT NOT NULL,
    "authorizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultId" TEXT,
    "payloadHash" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyPracticeAttempt" (
    "id" TEXT NOT NULL,
    "practiceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "assessment" JSONB,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "submissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "VocabularyPracticeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "provenance" JSONB NOT NULL,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "userId" TEXT,
    "taskKind" TEXT,
    "taskKey" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "thinkingTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "cacheWriteTokens" INTEGER,
    "totalTokens" INTEGER,
    "usageComplete" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER NOT NULL,
    "costUsd" DECIMAL(18,10),
    "pricingVersion" TEXT,
    "rawUsage" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerOrderId_key" ON "PaymentOrder"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerPaymentId_key" ON "PaymentOrder"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_createdAt_idx" ON "PaymentOrder"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_userId_requestKey_key" ON "PaymentOrder"("userId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementGrant_sourceKey_key" ON "EntitlementGrant"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "EntitlementGrant_orderId_key" ON "EntitlementGrant"("orderId");

-- CreateIndex
CREATE INDEX "EntitlementGrant_userId_status_endsAt_idx" ON "EntitlementGrant"("userId", "status", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_provider_environment_eventId_key" ON "BillingEvent"("provider", "environment", "eventId");

-- CreateIndex
CREATE INDEX "QuotaPeriod_userId_endsAt_idx" ON "QuotaPeriod"("userId", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuotaPeriod_userId_startsAt_key" ON "QuotaPeriod"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "TaskAuthorization_userId_status_idx" ON "TaskAuthorization"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAuthorization_kind_taskKey_key" ON "TaskAuthorization"("kind", "taskKey");

-- CreateIndex
CREATE INDEX "TaskSubmission_userId_status_idx" ON "TaskSubmission"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskSubmission_authorizationId_requestKey_key" ON "TaskSubmission"("authorizationId", "requestKey");

-- CreateIndex
CREATE INDEX "RewardEvent_userId_createdAt_idx" ON "RewardEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardEvent_provider_eventId_key" ON "RewardEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyPracticeAttempt_submissionId_key" ON "VocabularyPracticeAttempt"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyPracticeAttempt_practiceId_requestKey_key" ON "VocabularyPracticeAttempt"("practiceId", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyPracticeAttempt_practiceId_ordinal_key" ON "VocabularyPracticeAttempt"("practiceId", "ordinal");

-- CreateIndex
CREATE INDEX "ContentTranslation_entityType_entityId_locale_status_idx" ON "ContentTranslation"("entityType", "entityId", "locale", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_entityType_entityId_locale_sourceHash_key" ON "ContentTranslation"("entityType", "entityId", "locale", "sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "AiUsageRecord_requestId_key" ON "AiUsageRecord"("requestId");

-- CreateIndex
CREATE INDEX "AiUsageRecord_userId_createdAt_idx" ON "AiUsageRecord"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageRecord_taskKind_taskKey_idx" ON "AiUsageRecord"("taskKind", "taskKey");

-- CreateIndex
CREATE INDEX "AiUsageRecord_purpose_model_createdAt_idx" ON "AiUsageRecord"("purpose", "model", "createdAt");

