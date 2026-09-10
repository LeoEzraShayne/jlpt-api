-- Plan dates are calendar dates. Earlier clients serialized them at 12:00 UTC.
-- Normalize without changing their displayed calendar day or modification order.
UPDATE "StudyPlan"
SET "startDate" = date_trunc('day', "startDate"),
    "targetDate" = date_trunc('day', "targetDate")
WHERE "startDate" <> date_trunc('day', "startDate")
   OR "targetDate" <> date_trunc('day', "targetDate");
