-- AlterTable
ALTER TABLE "User" ADD COLUMN     "googlePlayAccountId" TEXT;

-- AlterTable
ALTER TABLE "BillingConfig" ADD COLUMN     "androidRewardsEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "androidSalesEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "BillingEvent" ADD COLUMN     "googlePurchaseId" TEXT;

-- CreateTable
CREATE TABLE "AndroidBindingRequest" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT,
    "codeChallenge" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "sourceSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "codeExpiresAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AndroidBindingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AndroidSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AndroidSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GooglePlayPurchase" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "userId" TEXT,
    "productId" TEXT,
    "purchaseOptionId" TEXT,
    "offerId" TEXT,
    "orderId" TEXT,
    "googleOrderId" TEXT,
    "googleLastEventTime" TEXT,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "consumeState" TEXT NOT NULL DEFAULT 'NOT_READY',
    "verifiedAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "evidence" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GooglePlayPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AndroidCommerceSyncState" (
    "id" TEXT NOT NULL,
    "watermarkAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AndroidCommerceSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "ssvUserId" TEXT NOT NULL,
    "adUnitId" TEXT NOT NULL,
    "ssvAdUnitId" TEXT NOT NULL,
    "rewardItem" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "redeemedAt" TIMESTAMP(3),
    "transactionId" TEXT,

    CONSTRAINT "RewardTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AndroidBindingRequest_codeHash_key" ON "AndroidBindingRequest"("codeHash");

-- CreateIndex
CREATE INDEX "AndroidBindingRequest_expiresAt_idx" ON "AndroidBindingRequest"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AndroidSession_tokenHash_key" ON "AndroidSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AndroidSession_userId_expiresAt_idx" ON "AndroidSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AndroidSession_sourceSessionId_idx" ON "AndroidSession"("sourceSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "GooglePlayPurchase_orderId_key" ON "GooglePlayPurchase"("orderId");

-- CreateIndex
CREATE INDEX "GooglePlayPurchase_state_nextAttemptAt_idx" ON "GooglePlayPurchase"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "GooglePlayPurchase_userId_createdAt_idx" ON "GooglePlayPurchase"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GooglePlayPurchase_googleOrderId_idx" ON "GooglePlayPurchase"("googleOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GooglePlayPurchase_packageName_tokenHash_key" ON "GooglePlayPurchase"("packageName", "tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RewardTicket_secretHash_key" ON "RewardTicket"("secretHash");

-- CreateIndex
CREATE UNIQUE INDEX "RewardTicket_transactionId_key" ON "RewardTicket"("transactionId");

-- CreateIndex
CREATE INDEX "RewardTicket_userId_status_idx" ON "RewardTicket"("userId", "status");

-- CreateIndex
CREATE INDEX "RewardTicket_expiresAt_idx" ON "RewardTicket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardTicket_userId_environment_requestKey_key" ON "RewardTicket"("userId", "environment", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_googlePlayAccountId_key" ON "User"("googlePlayAccountId");

-- CreateIndex
CREATE INDEX "BillingEvent_googlePurchaseId_status_idx" ON "BillingEvent"("googlePurchaseId", "status");
