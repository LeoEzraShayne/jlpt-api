-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dailyMinutes" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "learningV2Enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "primaryShare" INTEGER NOT NULL DEFAULT 80;

-- AlterTable
ALTER TABLE "StudyPlan" ADD COLUMN     "mode" "StudyPlanMode" NOT NULL DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "UserGrammarProgress" ADD COLUMN     "masteryRuleVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
ADD COLUMN     "needsWork" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudySession" ADD COLUMN     "scenarioId" TEXT,
ADD COLUMN     "trainingContext" JSONB,
ADD COLUMN     "trainingMode" TEXT;

-- AlterTable
ALTER TABLE "AiReviewResult" ADD COLUMN     "contentResponse" TEXT,
ADD COLUMN     "diversityAdvice" TEXT,
ADD COLUMN     "nextPractice" TEXT,
ADD COLUMN     "scenarioTaskCompleted" BOOLEAN;

-- AlterTable
ALTER TABLE "ReviewEvent" ADD COLUMN     "crossScenarioValid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dueReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "evidenceVersion" TEXT NOT NULL DEFAULT 'legacy-v1',
ADD COLUMN     "firstAttemptId" TEXT,
ADD COLUMN     "firstScore" INTEGER,
ADD COLUMN     "reviewDate" DATE,
ADD COLUMN     "scenarioId" TEXT,
ADD COLUMN     "scenarioTaskCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "targetGrammarCorrect" BOOLEAN;

-- CreateTable
CREATE TABLE "TrainingScenario" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "register" TEXT NOT NULL,
    "promptZh" TEXT NOT NULL,
    "levels" "JlptLevel"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" TEXT NOT NULL DEFAULT 'scenario-v1',

    CONSTRAINT "TrainingScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyActivityDay" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "studyDate" DATE NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StudyActivityDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainingScenario_active_domain_idx" ON "TrainingScenario"("active", "domain");

-- CreateIndex
CREATE INDEX "StudyActivityDay_userId_studyDate_idx" ON "StudyActivityDay"("userId", "studyDate");

-- CreateIndex
CREATE UNIQUE INDEX "StudyActivityDay_sessionId_studyDate_key" ON "StudyActivityDay"("sessionId", "studyDate");

-- AddForeignKey
ALTER TABLE "StudyActivityDay" ADD CONSTRAINT "StudyActivityDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyActivityDay" ADD CONSTRAINT "StudyActivityDay_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the old current-plan budget before archiving duplicate plans.
UPDATE "User" AS u SET "dailyMinutes" = chosen."dailyMinutes"
FROM (
  SELECT DISTINCT ON ("userId") "userId", "dailyMinutes"
  FROM "StudyPlan" WHERE status IN ('ACTIVE', 'PAUSED')
  ORDER BY "userId", "updatedAt" DESC, id DESC
) chosen WHERE chosen."userId" = u.id;

UPDATE "StudyPlan" AS p SET mode = 'GAP_FILL'
FROM "User" AS u WHERE p."userId" = u.id AND p.level <> u."targetLevel";

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY "userId", level
    ORDER BY (status = 'ACTIVE') DESC, "updatedAt" DESC, id DESC
  ) AS position
  FROM "StudyPlan" WHERE status IN ('ACTIVE', 'PAUSED')
)
UPDATE "StudyPlan" p SET status = 'ARCHIVED'
FROM ranked r WHERE p.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX "StudyPlan_one_current_per_level"
ON "StudyPlan" ("userId", level) WHERE status IN ('ACTIVE', 'PAUSED');

-- Retain history, including sessions attached to superseded tasks.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY "userId", "grammarId"
    ORDER BY (status = 'IN_PROGRESS') DESC, "taskDate" ASC, "createdAt" ASC, id ASC
  ) AS position
  FROM "StudyTask" WHERE type = 'REVIEW' AND status IN ('PENDING', 'IN_PROGRESS')
    AND "grammarId" IS NOT NULL
)
UPDATE "StudyTask" t SET status = 'SKIPPED', "skipReason" = 'MIGRATION_DEDUP'
FROM ranked r WHERE t.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX "StudyTask_one_open_review_per_grammar"
ON "StudyTask" ("userId", "grammarId")
WHERE type = 'REVIEW' AND status IN ('PENDING', 'IN_PROGRESS') AND "grammarId" IS NOT NULL;

ALTER TABLE "User" ADD CONSTRAINT "User_daily_budget_bounds"
CHECK ("dailyMinutes" BETWEEN 5 AND 480 AND "primaryShare" BETWEEN 0 AND 100);
ALTER TABLE "StudyActivityDay" ADD CONSTRAINT "StudyActivityDay_nonnegative"
CHECK ("activeSeconds" >= 0);
-- Historical evidence and daily time allocations deliberately remain unfilled.
