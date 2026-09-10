CREATE TYPE "ReviewMemoryState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');
CREATE TYPE "MemoryStateSource" AS ENUM ('LEGACY_BACKFILL', 'NATIVE');
CREATE TYPE "TaskSkipReason" AS ENUM ('PLAN_REPLACED', 'MIGRATION_DEDUP');

ALTER TABLE "StudyTask"
ADD COLUMN "planId" TEXT,
ADD COLUMN "progressId" TEXT,
ADD COLUMN "skipReason" "TaskSkipReason",
ADD COLUMN "estimatedMinutes" INTEGER;

ALTER TABLE "ReviewSchedule"
ADD COLUMN "nextReviewOn" DATE,
ADD COLUMN "algorithmVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
ADD COLUMN "stability" DOUBLE PRECISION,
ADD COLUMN "difficulty" DOUBLE PRECISION,
ADD COLUMN "fsrsState" "ReviewMemoryState",
ADD COLUMN "scheduledDays" INTEGER,
ADD COLUMN "elapsedDays" INTEGER,
ADD COLUMN "reps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lapses" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "stateSource" "MemoryStateSource";

ALTER TABLE "StudySession"
ADD COLUMN "activeSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "lastActivityAt" TIMESTAMP(3);

ALTER TABLE "AiReviewResult"
ADD COLUMN "rawTotalScore" INTEGER,
ADD COLUMN "usedTargetGrammar" BOOLEAN,
ADD COLUMN "targetGrammarCorrect" BOOLEAN,
ADD COLUMN "scorePolicyVersion" TEXT NOT NULL DEFAULT 'ai-score-v1';

CREATE TABLE "ReviewAlgorithmProfile" (
  "id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "schedulerPackage" TEXT NOT NULL,
  "schedulerPackageVersion" TEXT NOT NULL,
  "parameters" JSONB NOT NULL,
  "parameterHash" TEXT NOT NULL,
  "targetRetention" DOUBLE PRECISION NOT NULL,
  "minIntervalDays" INTEGER NOT NULL,
  "maxIntervalDays" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewAlgorithmProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReviewEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grammarId" TEXT NOT NULL,
  "progressId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "taskId" TEXT,
  "profileId" TEXT,
  "reviewedAt" TIMESTAMP(3) NOT NULL,
  "scheduledFor" DATE,
  "nextReviewOn" DATE NOT NULL,
  "elapsedDays" INTEGER NOT NULL,
  "submittedRating" "RecallRating" NOT NULL,
  "effectiveRating" "RecallRating" NOT NULL,
  "aiScore" INTEGER,
  "aiEvidence" TEXT NOT NULL,
  "affectsSchedule" BOOLEAN NOT NULL DEFAULT true,
  "retrievabilityBefore" DOUBLE PRECISION,
  "stabilityBefore" DOUBLE PRECISION,
  "stabilityAfter" DOUBLE PRECISION,
  "difficultyBefore" DOUBLE PRECISION,
  "difficultyAfter" DOUBLE PRECISION,
  "scheduledDaysAfter" INTEGER NOT NULL,
  "algorithmVersion" TEXT NOT NULL,
  "legacyOutcome" JSONB,
  "shadowOutcome" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReviewAlgorithmProfile_version_key" ON "ReviewAlgorithmProfile"("version");
CREATE INDEX "ReviewAlgorithmProfile_active_idx" ON "ReviewAlgorithmProfile"("active");
CREATE UNIQUE INDEX "ReviewEvent_sessionId_key" ON "ReviewEvent"("sessionId");
CREATE INDEX "ReviewEvent_userId_reviewedAt_idx" ON "ReviewEvent"("userId", "reviewedAt");
CREATE INDEX "ReviewEvent_progressId_reviewedAt_idx" ON "ReviewEvent"("progressId", "reviewedAt");
CREATE INDEX "ReviewEvent_algorithmVersion_reviewedAt_idx" ON "ReviewEvent"("algorithmVersion", "reviewedAt");
CREATE INDEX "ReviewSchedule_nextReviewOn_idx" ON "ReviewSchedule"("nextReviewOn");
CREATE INDEX "StudyTask_planId_status_idx" ON "StudyTask"("planId", "status");
CREATE INDEX "StudyTask_progressId_status_idx" ON "StudyTask"("progressId", "status");

ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_planId_fkey"
FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_progressId_fkey"
FOREIGN KEY ("progressId") REFERENCES "UserGrammarProgress"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_grammarId_fkey"
FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_progressId_fkey"
FOREIGN KEY ("progressId") REFERENCES "UserGrammarProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReviewEvent" ADD CONSTRAINT "ReviewEvent_profileId_fkey"
FOREIGN KEY ("profileId") REFERENCES "ReviewAlgorithmProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "AiReviewResult"
SET "rawTotalScore" = "totalScore"
WHERE "rawTotalScore" IS NULL;

UPDATE "ReviewSchedule" AS schedule
SET
  "nextReviewOn" = schedule."nextReviewAt"::date,
  "stability" = CASE progress."stage"
    WHEN 0 THEN 1 WHEN 1 THEN 3 WHEN 2 THEN 7 WHEN 3 THEN 14
    WHEN 4 THEN 30 ELSE 60 END,
  "difficulty" = CASE progress."status"::text
    WHEN 'NEEDS_WORK' THEN 7 WHEN 'MASTERED' THEN 3 ELSE 5 END,
  "fsrsState" = 'REVIEW',
  "scheduledDays" = CASE progress."stage"
    WHEN 0 THEN 1 WHEN 1 THEN 3 WHEN 2 THEN 7 WHEN 3 THEN 14
    WHEN 4 THEN 30 ELSE 60 END,
  "elapsedDays" = 0,
  "reps" = progress."reviewCount",
  "stateSource" = 'LEGACY_BACKFILL'
FROM "UserGrammarProgress" AS progress
WHERE schedule."progressId" = progress."id";

UPDATE "StudyTask" AS task
SET "progressId" = progress."id"
FROM "UserGrammarProgress" AS progress
WHERE task."userId" = progress."userId"
  AND task."grammarId" = progress."grammarId";

UPDATE "StudyTask" AS task
SET "planId" = (
  SELECT plan."id"
  FROM "StudyPlan" AS plan
  JOIN "GrammarPoint" AS grammar ON grammar."level" = plan."level"
  WHERE plan."userId" = task."userId"
    AND grammar."id" = task."grammarId"
  ORDER BY (plan."status" = 'ACTIVE') DESC, plan."updatedAt" DESC
  LIMIT 1
)
WHERE task."grammarId" IS NOT NULL;

WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY "progressId"
      ORDER BY (status = 'IN_PROGRESS') DESC, "taskDate" DESC, "createdAt" DESC
    ) AS position
  FROM "StudyTask"
  WHERE type = 'REVIEW'
    AND status IN ('PENDING', 'IN_PROGRESS')
    AND "progressId" IS NOT NULL
)
UPDATE "StudyTask" AS task
SET status = 'SKIPPED', "skipReason" = 'MIGRATION_DEDUP'
FROM ranked
WHERE task.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX "StudyTask_one_open_review_per_progress"
ON "StudyTask"("progressId")
WHERE type = 'REVIEW'
  AND status IN ('PENDING', 'IN_PROGRESS')
  AND "progressId" IS NOT NULL;

INSERT INTO "ReviewAlgorithmProfile" (
  "id", "version", "schedulerPackage", "schedulerPackageVersion",
  "parameters", "parameterHash", "targetRetention", "minIntervalDays",
  "maxIntervalDays", "active"
) VALUES (
  'adaptive-v1-default',
  'adaptive-v1',
  'ts-fsrs',
  '5.4.1',
  '{"request_retention":0.9,"maximum_interval":365,"enable_fuzz":false,"enable_short_term":false,"learning_steps":[],"relearning_steps":[]}'::jsonb,
  'ts-fsrs-5.4.1-retention-0.90-max-365-no-fuzz',
  0.9,
  1,
  365,
  true
);
