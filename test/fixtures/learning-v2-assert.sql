DO $$ BEGIN
  IF (SELECT "dailyMinutes" FROM "User" WHERE id='migration-old') <> 25 THEN
    RAISE EXCEPTION 'budget must inherit latest old current plan, not sum'; END IF;
  IF (SELECT count(*) FROM "StudyPlan" WHERE "userId"='migration-old' AND status='ARCHIVED') <> 2 THEN
    RAISE EXCEPTION 'extra current plans must be archived'; END IF;
  IF (SELECT status FROM "StudyPlan" WHERE id='old-n1-active-new') <> 'ACTIVE' THEN
    RAISE EXCEPTION 'newest active must win'; END IF;
  IF (SELECT status FROM "StudyPlan" WHERE id='paused-only') <> 'PAUSED' THEN
    RAISE EXCEPTION 'paused plan must remain paused'; END IF;
  IF (SELECT count(*) FROM "StudyTask" WHERE "userId"='migration-old') <> 2 THEN
    RAISE EXCEPTION 'history must be retained'; END IF;
  IF (SELECT count(*) FROM "StudyTask" WHERE "userId"='migration-old' AND status='PENDING') <> 1 THEN
    RAISE EXCEPTION 'duplicate reviews must be retired'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "UserGrammarProgress" WHERE id='migration-progress'
    AND status='MASTERED' AND "masteryRuleVersion"='legacy-v1') THEN
    RAISE EXCEPTION 'legacy mastery must be preserved and versioned'; END IF;
  IF (SELECT count(*) FROM "ReviewEvent") <> 0 THEN
    RAISE EXCEPTION 'must not manufacture historical evidence'; END IF;
  IF (SELECT count(*) FROM "User" WHERE "learningV2Enabled") <> 0 THEN
    RAISE EXCEPTION 'rollout must default off'; END IF;
END $$;
