-- Relabel the 43 grammar points previously exposed as N5 to N4 while
-- preserving all foreign-key relationships to those grammar point records.
UPDATE "User" SET "targetLevel" = 'N4' WHERE "targetLevel" = 'N5';
UPDATE "GrammarPoint" SET "level" = 'N4' WHERE "level" = 'N5';
UPDATE "GrammarRelationGroup" SET "level" = 'N4' WHERE "level" = 'N5';
UPDATE "StudyPlan" SET "level" = 'N4' WHERE "level" = 'N5';

ALTER TYPE "JlptLevel" RENAME TO "JlptLevel_old";
CREATE TYPE "JlptLevel" AS ENUM ('N1', 'N2', 'N3', 'N4');

ALTER TABLE "User"
  ALTER COLUMN "targetLevel" DROP DEFAULT,
  ALTER COLUMN "targetLevel" TYPE "JlptLevel" USING ("targetLevel"::text::"JlptLevel"),
  ALTER COLUMN "targetLevel" SET DEFAULT 'N1';
ALTER TABLE "GrammarPoint"
  ALTER COLUMN "level" TYPE "JlptLevel" USING ("level"::text::"JlptLevel");
ALTER TABLE "GrammarRelationGroup"
  ALTER COLUMN "level" TYPE "JlptLevel" USING ("level"::text::"JlptLevel");
ALTER TABLE "StudyPlan"
  ALTER COLUMN "level" TYPE "JlptLevel" USING ("level"::text::"JlptLevel");

DROP TYPE "JlptLevel_old";
