# F independent acceptance findings

## F-001 — P0: Session completion fails on real PostgreSQL

Status: FIXED by main commit `03d7224`, verified in F's real PostgreSQL harness.

`src/study-sessions/study-session-completion.ts` previously selected `pg_advisory_xact_lock(hashtextextended(...,0))` through `$queryRaw`. PostgreSQL returns `void`, which Prisma 7.9.1 / adapter-pg cannot deserialize. Both legacy and V2 completion paths returned HTTP 500 before saving evidence.

Main changed the query to project `1 AS locked` from the advisory-lock function, preserving the user → session → grammar lock order. The original reproducer and all completion/concurrency cases now pass.

Reproducer: `npx jest --config test/learning-v2/jest.json --runInBand --testNamePattern='due completion 80'`.

No remaining reproducible backend defect was found in the completed F cases. This does not replace browser/mobile or live provider acceptance.

## Reproducible commands

From the API repository root:

- `npx jest --config test/learning-v2/jest.json --runInBand`
- `npm run test:migration --silent`
- `npx eslint test/learning-v2/*.ts`
- `npx tsc --noEmit --pretty false`
- `npm run build --silent`
- `npm run check:lines --silent`
- `npm test -- --runInBand`

Suggested package script for main to add: `"test:learning-v2": "jest --config test/learning-v2/jest.json --runInBand"`.

## Harness boundaries

The harness creates and removes only its own random `jlpt_v2_test_<time>_<random>` database, defaults to local PostgreSQL `postgres://shen@localhost:5432/postgres`, and rejects non-local `TEST_DATABASE_ADMIN_URL`. It applies every SQL migration in order. Dedicated integration and production databases are never reset or used.

Configuration is explicit and test-only. `.env` is not parsed, process secrets are ignored, provider keys are empty, and no AI worker is instantiated. HTTP tests use the actual `AuthService` to create hashed sessions and authenticate cookies through the unchanged `SessionGuard`; only external Google OAuth is replaced by a synthetic profile. Real feature modules, controllers, validation pipe, exception format, and the production-equivalent 2 MB JSON parser are used. Global throttling and production OriginGuard are outside this harness.

Synthetic AI results are stored as completed review jobs; this intentionally tests evidence consumption independently of model variability. Invalid input is never submitted to a real provider. Raw supertest response bodies are checked with runtime assertions; test-only lint exceptions cover their library-provided `any` type.

## Coverage

- Concurrent same-level plan creation, all four levels, primary stability, paused-current uniqueness and restoration, cross-owner plan requests.
- 80/20 allocation and lending, foundation backlog preserving primary learning, concurrent refresh IDs, total time after edits, legacy plus ledger minutes, actual overrun.
- Noon-date normalization, future starts, gap-fill first checks without learned status; forecast first-day allocation equals generated tasks; enabled/all/level queue filtering.
- Multidevice heartbeats count each elapsed second once; midnight activity splits between dates and today's budget excludes yesterday's time.
- 79/80 boundary, hints, target grammar errors, remembered/forgotten/missing score, immutable first attempt, concurrent duplicate completion, early and same-day sessions, overdue mastery preservation.
- Three distinct due dates with first score 80 need a genuinely different persisted objective; same objective with renamed scene does not qualify.
- Five actual HTTP sessions progress UNDERSTAND → SUBSTITUTE → SUBSTITUTE → COMBINE → TRANSFER, consume server scene assignments and fixed AI judgments, and establish mastery. Auxiliary grammar remains ungraded.
- Private expression redaction on create/GET/complete, reveal records hints, auxiliary endpoints do not expose references, forged DTO scene fields cannot determine assignments.
- Checked-expression job ownership; private vocabulary/import/validation/bookmark ownership and cursors; duplicate document format deduplication; distinct readings and meanings; garbage/unverifiable labels cannot publish; >200 KB import and pagination.
- Independent legacy fixture: active plan outranks newer paused plan, budget inherits old current configuration, paused-only retains newest pause, noon dates normalize, in-progress duplicate review is retained, old task/session history and mastery versions survive.

## Remaining acceptance outside F's current write boundary

Frontend browser/mobile end-to-end testing must run against the integrated E frontend in its designated worktree; F has not claimed it passed. Live AI accuracy/cost/latency checks belong to main's separately configured bounded smoke test. Long-term retention improvement is not established by these deterministic tests. Production migration and release remain excluded.
