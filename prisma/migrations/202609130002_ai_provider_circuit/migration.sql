-- Additive provider quota circuit; no existing learning or billing data changes.
CREATE TABLE "AiProviderCircuit" (
    "key" TEXT NOT NULL,
    "blockedUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "reason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiProviderCircuit_pkey" PRIMARY KEY ("key")
);
