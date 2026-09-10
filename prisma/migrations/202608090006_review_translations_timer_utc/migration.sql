ALTER TABLE "AiReviewResult"
ADD COLUMN "correctedSentenceTranslationZh" TEXT,
ADD COLUMN "alternativeSentenceTranslationZh" TEXT;

-- Prisma DateTime maps to timestamp without time zone. Store an explicit UTC
-- wall-clock value so the API serializes the intended instant.
UPDATE "StudySession"
SET
  "timerPhaseStartedAt" = timezone('UTC', CURRENT_TIMESTAMP),
  "timerPhaseEndsAt" = timezone('UTC', CURRENT_TIMESTAMP) + INTERVAL '10 minutes'
WHERE status = 'ACTIVE';
