-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('sunshine', 'coral', 'mint', 'ocean', 'violet');

-- CreateEnum
CREATE TYPE "JlptLevel" AS ENUM ('N1', 'N2', 'N3', 'N4', 'N5');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DISABLED');

-- CreateEnum
CREATE TYPE "RelationType" AS ENUM ('CONFUSABLE', 'SIMILAR');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('DRY_RUN', 'VALIDATED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "StudyPlanStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('LEARN', 'REVIEW', 'PRACTICE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ProgressStatus" AS ENUM ('NOT_STARTED', 'LEARNING', 'DUE', 'MASTERED', 'NEEDS_WORK');

-- CreateEnum
CREATE TYPE "SessionMode" AS ENUM ('LEARN', 'REVIEW', 'PRACTICE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "RecallRating" AS ENUM ('FORGOT', 'FUZZY', 'REMEMBERED');

-- CreateEnum
CREATE TYPE "AttemptSource" AS ENUM ('NEW_LEARNING', 'REVIEW', 'FREE_PRACTICE', 'RETRY');

-- CreateEnum
CREATE TYPE "AiJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('GEMINI', 'DEEPSEEK');

-- CreateEnum
CREATE TYPE "ReviewResultLevel" AS ENUM ('CORRECT', 'MOSTLY_CORRECT', 'NEEDS_REVISION', 'INCORRECT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "targetLevel" "JlptLevel" NOT NULL DEFAULT 'N1',
    "colorTheme" "Theme" NOT NULL DEFAULT 'sunshine',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarPoint" (
    "id" TEXT NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "chineseExplanation" TEXT NOT NULL,
    "connectionRule" TEXT,
    "usageScene" TEXT,
    "commonErrors" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'PUBLISHED',
    "sourceDataset" TEXT NOT NULL,
    "sourceOrdinal" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GrammarPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarExample" (
    "id" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "GrammarExample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarRelationGroup" (
    "id" TEXT NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "type" "RelationType" NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "GrammarRelationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrammarRelationMember" (
    "groupId" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,

    CONSTRAINT "GrammarRelationMember_pkey" PRIMARY KEY ("groupId","grammarId")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "dataset" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL,
    "summary" JSONB NOT NULL,
    "operatorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportError" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "line" INTEGER,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,

    CONSTRAINT "ImportError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "JlptLevel" NOT NULL,
    "targetDate" TIMESTAMP(3) NOT NULL,
    "dailyMinutes" INTEGER NOT NULL,
    "dailyNewLimit" INTEGER NOT NULL,
    "status" "StudyPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grammarId" TEXT,
    "taskDate" DATE NOT NULL,
    "type" "TaskType" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGrammarProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,
    "status" "ProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "stage" INTEGER NOT NULL DEFAULT 0,
    "masteryScore" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "correctStreak" INTEGER NOT NULL DEFAULT 0,
    "lastScore" INTEGER,
    "lastStudiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserGrammarProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSchedule" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "lastReviewAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,
    "taskId" TEXT,
    "mode" "SessionMode" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revealedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentenceAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,
    "studySessionId" TEXT NOT NULL,
    "source" "AttemptSource" NOT NULL,
    "sentence" VARCHAR(150) NOT NULL,
    "scene" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentenceAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReviewJob" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "status" "AiJobStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" "AiProvider",
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiReviewJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiReviewResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "totalScore" INTEGER NOT NULL,
    "grammarScore" INTEGER NOT NULL,
    "connectionScore" INTEGER NOT NULL,
    "completenessScore" INTEGER NOT NULL,
    "naturalnessScore" INTEGER NOT NULL,
    "vocabularyScore" INTEGER NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "resultLevel" "ReviewResultLevel" NOT NULL,
    "errorSpans" JSONB NOT NULL,
    "correctedSentence" TEXT NOT NULL,
    "alternativeSentence" TEXT,
    "explanationZh" TEXT NOT NULL,
    "encouragement" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiReviewResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStudyStat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "studyDate" DATE NOT NULL,
    "studyMinutes" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "sentenceCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStudyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthAccount_provider_providerAccountId_key" ON "AuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_expiresAt_idx" ON "AuthSession"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "GrammarPoint_level_status_sortOrder_idx" ON "GrammarPoint"("level", "status", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarPoint_sourceDataset_level_sourceOrdinal_key" ON "GrammarPoint"("sourceDataset", "level", "sourceOrdinal");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarExample_grammarId_sortOrder_key" ON "GrammarExample"("grammarId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "GrammarRelationGroup_level_type_sortOrder_key" ON "GrammarRelationGroup"("level", "type", "sortOrder");

-- CreateIndex
CREATE INDEX "GrammarRelationMember_grammarId_idx" ON "GrammarRelationMember"("grammarId");

-- CreateIndex
CREATE INDEX "ImportError_batchId_idx" ON "ImportError"("batchId");

-- CreateIndex
CREATE INDEX "StudyPlan_userId_status_idx" ON "StudyPlan"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudyTask_idempotencyKey_key" ON "StudyTask"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StudyTask_userId_taskDate_status_idx" ON "StudyTask"("userId", "taskDate", "status");

-- CreateIndex
CREATE INDEX "UserGrammarProgress_userId_status_idx" ON "UserGrammarProgress"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "UserGrammarProgress_userId_grammarId_key" ON "UserGrammarProgress"("userId", "grammarId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSchedule_progressId_key" ON "ReviewSchedule"("progressId");

-- CreateIndex
CREATE INDEX "ReviewSchedule_nextReviewAt_idx" ON "ReviewSchedule"("nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudySession_taskId_key" ON "StudySession"("taskId");

-- CreateIndex
CREATE INDEX "StudySession_userId_status_idx" ON "StudySession"("userId", "status");

-- CreateIndex
CREATE INDEX "SentenceAttempt_userId_createdAt_idx" ON "SentenceAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SentenceAttempt_grammarId_idx" ON "SentenceAttempt"("grammarId");

-- CreateIndex
CREATE UNIQUE INDEX "AiReviewJob_attemptId_key" ON "AiReviewJob"("attemptId");

-- CreateIndex
CREATE INDEX "AiReviewJob_status_availableAt_idx" ON "AiReviewJob"("status", "availableAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiReviewResult_jobId_key" ON "AiReviewResult"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyStudyStat_userId_studyDate_key" ON "DailyStudyStat"("userId", "studyDate");

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarExample" ADD CONSTRAINT "GrammarExample_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarRelationMember" ADD CONSTRAINT "GrammarRelationMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "GrammarRelationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GrammarRelationMember" ADD CONSTRAINT "GrammarRelationMember_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportError" ADD CONSTRAINT "ImportError_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyTask" ADD CONSTRAINT "StudyTask_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGrammarProgress" ADD CONSTRAINT "UserGrammarProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGrammarProgress" ADD CONSTRAINT "UserGrammarProgress_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSchedule" ADD CONSTRAINT "ReviewSchedule_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "UserGrammarProgress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "StudyTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAttempt" ADD CONSTRAINT "SentenceAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAttempt" ADD CONSTRAINT "SentenceAttempt_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentenceAttempt" ADD CONSTRAINT "SentenceAttempt_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReviewJob" ADD CONSTRAINT "AiReviewJob_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "SentenceAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiReviewResult" ADD CONSTRAINT "AiReviewResult_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiReviewJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyStudyStat" ADD CONSTRAINT "DailyStudyStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

