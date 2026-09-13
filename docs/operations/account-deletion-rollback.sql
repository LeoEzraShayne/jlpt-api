-- Only after stopping writers and reverting to a schema-compatible old binary.
-- Never remove deletion protections if any real or synthetic tombstone exists.
BEGIN;
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" WHERE "deletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK_FORBIDDEN_TOMBSTONES_EXIST';
  END IF;
END $$;
DROP FUNCTION guard_account_owned_write() CASCADE;
DROP FUNCTION guard_indirect_account_write() CASCADE;
DROP FUNCTION guard_deleted_user_profile() CASCADE;
DROP FUNCTION guard_account_financial_write() CASCADE;
DROP FUNCTION assert_active_account(text);
DROP FUNCTION lock_account_subject(text, boolean);
ALTER TABLE "User" DROP COLUMN "deletedAt";
COMMIT;
