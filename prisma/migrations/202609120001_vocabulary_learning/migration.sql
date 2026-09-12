-- CreateTable
CREATE TABLE "VocabularyLearning" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "knowledge" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "practiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "manualRevision" INTEGER NOT NULL DEFAULT 0,
    "nextReviewAt" TIMESTAMP(3),
    "lastPracticedAt" TIMESTAMP(3),
    "lastOutcome" TEXT,
    "memoryCard" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyLearning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyPractice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "learningId" TEXT NOT NULL,
    "grammarId" TEXT,
    "linkedStudySessionId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "learningRevision" INTEGER NOT NULL,
    "unknownAtStart" BOOLEAN NOT NULL,
    "dueAtStart" BOOLEAN NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT false,
    "challenge" JSONB,
    "answer" TEXT,
    "requestKey" TEXT,
    "hintLevel" INTEGER NOT NULL DEFAULT 0,
    "assessment" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedAt" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyPractice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VocabularyLearning_userId_paused_nextReviewAt_idx" ON "VocabularyLearning"("userId", "paused", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyLearning_userId_vocabularyId_key" ON "VocabularyLearning"("userId", "vocabularyId");

-- CreateIndex
CREATE INDEX "VocabularyPractice_status_availableAt_idx" ON "VocabularyPractice"("status", "availableAt");

-- CreateIndex
CREATE INDEX "VocabularyPractice_userId_vocabularyId_createdAt_idx" ON "VocabularyPractice"("userId", "vocabularyId", "createdAt");

-- AddForeignKey
ALTER TABLE "VocabularyLearning" ADD CONSTRAINT "VocabularyLearning_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyLearning" ADD CONSTRAINT "VocabularyLearning_vocabularyId_fkey" FOREIGN KEY ("vocabularyId") REFERENCES "VocabularyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyPractice" ADD CONSTRAINT "VocabularyPractice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyPractice" ADD CONSTRAINT "VocabularyPractice_vocabularyId_fkey" FOREIGN KEY ("vocabularyId") REFERENCES "VocabularyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyPractice" ADD CONSTRAINT "VocabularyPractice_learningId_fkey" FOREIGN KEY ("learningId") REFERENCES "VocabularyLearning"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyPractice" ADD CONSTRAINT "VocabularyPractice_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "GrammarPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyPractice" ADD CONSTRAINT "VocabularyPractice_linkedStudySessionId_fkey" FOREIGN KEY ("linkedStudySessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;


CREATE UNIQUE INDEX "VocabularyPractice_one_open_per_learning"
ON "VocabularyPractice" ("learningId")
WHERE status IN ('QUEUED', 'GENERATING', 'READY', 'ASSESSING');
