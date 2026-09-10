UPDATE "StudySession"
SET
  "timerPhaseStartedAt" = CURRENT_TIMESTAMP,
  "timerPhaseEndsAt" = CURRENT_TIMESTAMP + INTERVAL '10 minutes'
WHERE status = 'ACTIVE' AND "timerPhase" = 'FOCUS';
