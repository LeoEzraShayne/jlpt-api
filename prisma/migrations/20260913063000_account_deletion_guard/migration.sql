ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- The retained, non-authenticating subject serializes deletion and late writes.
-- Financial callbacks may lock deleted subjects for accounting only.
CREATE FUNCTION lock_account_subject(subject_id text, allow_deleted boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE deleted timestamp; present boolean;
BEGIN
  SELECT "deletedAt" INTO deleted FROM "User" WHERE id=subject_id FOR UPDATE;
  present := FOUND;
  IF (NOT present OR deleted IS NOT NULL) AND NOT allow_deleted THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED_OR_MISSING' USING ERRCODE='23514';
  END IF;
  RETURN present AND deleted IS NULL;
END $$;

CREATE FUNCTION assert_active_account(subject_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE deleted timestamp;
BEGIN
  IF subject_id IS NULL THEN RETURN; END IF;
  SELECT "deletedAt" INTO deleted FROM "User" WHERE id=subject_id FOR SHARE;
  IF NOT FOUND OR deleted IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_DELETED_OR_MISSING' USING ERRCODE='23514';
  END IF;
END $$;

CREATE FUNCTION guard_account_owned_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_id text; previous_id text;
BEGIN
  subject_id := to_jsonb(NEW)->>TG_ARGV[0];
  IF TG_OP='UPDATE' THEN previous_id := to_jsonb(OLD)->>TG_ARGV[0]; END IF;
  -- Stable ordering if an ownership update names two accounts.
  IF previous_id IS NOT NULL AND previous_id IS DISTINCT FROM subject_id THEN
    IF subject_id IS NOT NULL AND subject_id < previous_id THEN
      PERFORM assert_active_account(subject_id); PERFORM assert_active_account(previous_id);
    ELSE
      PERFORM assert_active_account(previous_id); PERFORM assert_active_account(subject_id);
    END IF;
  ELSE PERFORM assert_active_account(subject_id);
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['AuthAccount','AuthSession','StudyPlan','StudyTask','UserGrammarProgress','StudySession','SentenceAttempt','ReviewEvent','DailyStudyStat','StudyActivityDay','VocabularyBookmark','PersonalExpression','ContentImport','ContentCandidate','ContentExposure','VocabularyLearning','VocabularyPractice','QuotaAccount','QuotaPeriod','TaskAuthorization','TaskSubmission','RewardEvent','VocabularyPracticeAttempt','AndroidBindingRequest','AndroidSession','RewardTicket'] LOOP
    EXECUTE format('CREATE TRIGGER account_owned_write BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_account_owned_write(''userId'')', table_name);
  END LOOP;
END $$;
CREATE TRIGGER account_owned_write BEFORE INSERT OR UPDATE ON "VocabularyEntry" FOR EACH ROW EXECUTE FUNCTION guard_account_owned_write('ownerId');
CREATE TRIGGER account_owned_write BEFORE INSERT OR UPDATE ON "ImportBatch" FOR EACH ROW EXECUTE FUNCTION guard_account_owned_write('operatorId');

CREATE FUNCTION guard_indirect_account_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject_id text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'AiReviewJob' THEN SELECT "userId" INTO subject_id FROM "SentenceAttempt" WHERE id=NEW."attemptId";
    WHEN 'AiReviewResult' THEN SELECT a."userId" INTO subject_id FROM "AiReviewJob" j JOIN "SentenceAttempt" a ON a.id=j."attemptId" WHERE j.id=NEW."jobId";
    WHEN 'ReviewSchedule' THEN SELECT "userId" INTO subject_id FROM "UserGrammarProgress" WHERE id=NEW."progressId";
  END CASE;
  -- Missing parent is rejected by the existing FK constraint.
  PERFORM assert_active_account(subject_id);
  RETURN NEW;
END $$;
CREATE TRIGGER account_indirect_write BEFORE INSERT OR UPDATE ON "AiReviewJob" FOR EACH ROW EXECUTE FUNCTION guard_indirect_account_write();
CREATE TRIGGER account_indirect_write BEFORE INSERT OR UPDATE ON "AiReviewResult" FOR EACH ROW EXECUTE FUNCTION guard_indirect_account_write();
CREATE TRIGGER account_indirect_write BEFORE INSERT OR UPDATE ON "ReviewSchedule" FOR EACH ROW EXECUTE FUNCTION guard_indirect_account_write();

CREATE FUNCTION guard_deleted_user_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."deletedAt" IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'DELETED_ACCOUNT_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER deleted_user_immutable BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION guard_deleted_user_profile();

CREATE FUNCTION guard_account_financial_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE deleted timestamp; missing boolean;
BEGIN
  IF NEW."userId" IS NULL THEN RETURN NEW; END IF;
  SELECT "deletedAt" INTO deleted FROM "User" WHERE id=NEW."userId" FOR SHARE;
  missing := NOT FOUND;
  IF missing OR deleted IS NOT NULL THEN
    IF TG_TABLE_NAME='AiUsageRecord' THEN
      IF TG_OP='INSERT' THEN RAISE EXCEPTION 'ACCOUNT_DELETED_OR_MISSING' USING ERRCODE='23514'; END IF;
      NEW."userId":=NULL; NEW."taskKind":=NULL; NEW."taskKey":=NULL;
    ELSIF TG_TABLE_NAME='EntitlementGrant' THEN
      NEW.status:='REVOKED'; NEW."revokedAt":=COALESCE(NEW."revokedAt", CURRENT_TIMESTAMP AT TIME ZONE 'UTC'); NEW.metadata:=NULL;
    ELSIF TG_TABLE_NAME='PaymentOrder' THEN
      IF TG_OP='INSERT' AND NEW.provider<>'GOOGLE' THEN RAISE EXCEPTION 'ACCOUNT_DELETED_OR_MISSING' USING ERRCODE='23514'; END IF;
      NEW."checkoutUrl":=NULL; NEW.snapshot:='{}'::jsonb;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_financial_write BEFORE INSERT OR UPDATE ON "AiUsageRecord" FOR EACH ROW EXECUTE FUNCTION guard_account_financial_write();
CREATE TRIGGER account_financial_write BEFORE INSERT OR UPDATE ON "EntitlementGrant" FOR EACH ROW EXECUTE FUNCTION guard_account_financial_write();
CREATE TRIGGER account_financial_write BEFORE INSERT OR UPDATE ON "PaymentOrder" FOR EACH ROW EXECUTE FUNCTION guard_account_financial_write();
