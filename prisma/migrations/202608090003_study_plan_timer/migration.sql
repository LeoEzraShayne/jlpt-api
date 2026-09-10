CREATE TYPE "TimerPhase" AS ENUM ('FOCUS', 'BREAK');

ALTER TABLE "StudyPlan" ADD COLUMN "startDate" TIMESTAMP(3);
UPDATE "StudyPlan"
SET "startDate" = date_trunc('day', "createdAt");
ALTER TABLE "StudyPlan" ALTER COLUMN "startDate" SET NOT NULL;

ALTER TABLE "StudySession"
  ADD COLUMN "timerPhase" "TimerPhase" NOT NULL DEFAULT 'FOCUS',
  ADD COLUMN "timerPhaseStartedAt" TIMESTAMP(3),
  ADD COLUMN "timerPhaseEndsAt" TIMESTAMP(3);

UPDATE "StudySession"
SET
  "timerPhaseStartedAt" = CURRENT_TIMESTAMP,
  "timerPhaseEndsAt" = CURRENT_TIMESTAMP + INTERVAL '40 minutes';

ALTER TABLE "StudySession"
  ALTER COLUMN "timerPhaseStartedAt" SET NOT NULL,
  ALTER COLUMN "timerPhaseStartedAt" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "timerPhaseEndsAt" SET NOT NULL;
