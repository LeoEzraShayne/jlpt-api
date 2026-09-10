-- Only load into the dedicated, disposable migration test database.
INSERT INTO "User" (id,email,"displayName","targetLevel","updatedAt") VALUES
 ('migration-old','migration-old@example.invalid','Migration fixture','N1','2026-09-09'),
 ('migration-paused','migration-paused@example.invalid','Paused fixture','N2','2026-09-09');
INSERT INTO "StudyPlan" (id,"userId",level,"startDate","targetDate","dailyMinutes","dailyNewLimit",status,"updatedAt") VALUES
 ('old-n1-active','migration-old','N1','2026-08-01','2026-12-01',40,3,'ACTIVE','2026-09-01'),
 ('old-n1-paused','migration-old','N1','2026-08-01','2026-12-01',90,3,'PAUSED','2026-09-02'),
 ('old-n1-active-new','migration-old','N1','2026-08-01','2026-12-01',45,3,'ACTIVE','2026-09-03'),
 ('old-n2-paused','migration-old','N2','2026-08-01','2026-12-01',25,3,'PAUSED','2026-09-04'),
 ('paused-only','migration-paused','N2','2026-08-01','2026-12-01',35,3,'PAUSED','2026-09-02');
INSERT INTO "GrammarPoint" (id,level,title,"chineseExplanation","sortOrder","sourceDataset","sourceOrdinal","sourceHash","updatedAt") VALUES
 ('migration-grammar','N1','～に至るまで','甚至',1,'migration-fixture',1,'migration-hash','2026-09-09');
INSERT INTO "UserGrammarProgress" (id,"userId","grammarId",status,"reviewCount","updatedAt") VALUES
 ('migration-progress','migration-old','migration-grammar','MASTERED',8,'2026-09-09');
INSERT INTO "ReviewSchedule" (id,"progressId","nextReviewAt","algorithmVersion",stability,reps) VALUES
 ('migration-schedule','migration-progress','2026-09-01','adaptive-v1',40,8);
INSERT INTO "StudyTask" (id,"userId","planId","progressId","grammarId","taskDate",type,status,"idempotencyKey") VALUES
 ('duplicate-review-1','migration-old','old-n1-active-new','migration-progress','migration-grammar','2026-09-01','REVIEW','PENDING','migration-review-1'),
 ('duplicate-review-2','migration-old','old-n1-active-new',NULL,'migration-grammar','2026-09-02','REVIEW','PENDING','migration-review-2');
