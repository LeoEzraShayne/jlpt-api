-- CreateTable
CREATE TABLE "VocabularyEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "senseKey" TEXT NOT NULL,
    "partOfSpeech" TEXT[],
    "glosses" JSONB NOT NULL,
    "chineseGloss" TEXT,
    "chineseGlossSource" TEXT,
    "level" "JlptLevel",
    "levelSource" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceVersion" TEXT NOT NULL,
    "sourceEntryId" TEXT,
    "license" TEXT,
    "validationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VocabularyBookmark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vocabularyId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VocabularyBookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalExpression" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grammarId" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "furigana" TEXT,
    "translationZh" TEXT,
    "scenarioId" TEXT,
    "scene" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalExpression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentImport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "license" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "summary" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "senseKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "validationStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "validationNotes" TEXT NOT NULL DEFAULT '',
    "vocabularyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "interaction" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentExposure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyEntry_fingerprint_key" ON "VocabularyEntry"("fingerprint");

-- CreateIndex
CREATE INDEX "VocabularyEntry_ownerId_validationStatus_level_idx" ON "VocabularyEntry"("ownerId", "validationStatus", "level");

-- CreateIndex
CREATE INDEX "VocabularyEntry_word_reading_idx" ON "VocabularyEntry"("word", "reading");

-- CreateIndex
CREATE INDEX "VocabularyBookmark_userId_createdAt_idx" ON "VocabularyBookmark"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VocabularyBookmark_userId_vocabularyId_key" ON "VocabularyBookmark"("userId", "vocabularyId");

-- CreateIndex
CREATE INDEX "PersonalExpression_userId_grammarId_createdAt_idx" ON "PersonalExpression"("userId", "grammarId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalExpression_userId_reviewId_variant_key" ON "PersonalExpression"("userId", "reviewId", "variant");

-- CreateIndex
CREATE INDEX "ContentImport_userId_createdAt_idx" ON "ContentImport"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentImport_userId_fingerprint_key" ON "ContentImport"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "ContentCandidate_userId_importId_validationStatus_idx" ON "ContentCandidate"("userId", "importId", "validationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCandidate_userId_fingerprint_key" ON "ContentCandidate"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "ContentExposure_userId_contentType_contentId_idx" ON "ContentExposure"("userId", "contentType", "contentId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentExposure_userId_sessionId_contentType_contentId_inte_key" ON "ContentExposure"("userId", "sessionId", "contentType", "contentId", "interaction");

-- AddForeignKey
ALTER TABLE "VocabularyEntry" ADD CONSTRAINT "VocabularyEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyBookmark" ADD CONSTRAINT "VocabularyBookmark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VocabularyBookmark" ADD CONSTRAINT "VocabularyBookmark_vocabularyId_fkey" FOREIGN KEY ("vocabularyId") REFERENCES "VocabularyEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalExpression" ADD CONSTRAINT "PersonalExpression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentImport" ADD CONSTRAINT "ContentImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCandidate" ADD CONSTRAINT "ContentCandidate_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ContentImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentExposure" ADD CONSTRAINT "ContentExposure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
