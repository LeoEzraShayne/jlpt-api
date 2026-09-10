# F independent acceptance findings

## F-001 — P0: Every session completion fails on real PostgreSQL

Status: OPEN. Reproduced on integration baseline a377aa0 with Prisma 7.9.1 / adapter-pg / PostgreSQL 14.

`src/study-sessions/study-session-completion.ts:71` runs `SELECT pg_advisory_xact_lock(hashtextextended(...,0))` through `$queryRaw`. The returned PostgreSQL `void` type is unsupported by Prisma's adapter. Result: P2010 `Failed to deserialize column of type 'void'`, HTTP 500; transaction rolls back before any evidence is saved. Both old and V2 completion paths are affected.

Suggested main-owned fix: execute lock with `$executeRaw` or project a supported scalar after taking lock; retain locking order.

Reproduce: `npx jest --config test/learning-v2/jest.json --runInBand --testNamePattern='due completion 80'`.

9 tests already pass: plans concurrency/time budgets/dates/pause/gap marker; content ownership, dedup, validation, large JSON pagination, checked expression storage.

No business files were changed by F. No production .env read; all tests use fresh unique disposable local databases and synthetic scores.
