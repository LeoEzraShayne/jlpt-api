# Sentence Lab independent acceptance (F)

These tests exercise production services against real disposable PostgreSQL databases. No database behavior is mocked. The Stripe suite uses the real SDK webhook signature verifier and a deterministic provider simulator, so it proves local reconciliation behavior, **not Stripe sandbox/live delivery**. AI providers are deterministic fixtures in memory-evidence tests; these are **not language-quality or cost acceptance**.

## Run

From a checkout containing W0, C's corpus, and A's billing delivery:

```sh
DATABASE_URL=postgresql://localhost:5432/jlpt_f_acceptance_test_generation npm ci --no-audit --no-fund
ACCEPTANCE_STATIC_SNAPSHOT=/absolute/path/to/public-static-content.json npx jest --config test/sentence-lab/jest.json --runInBand
```

`DATABASE_URL` during installation only permits Prisma generation; no connection is opened. Test code never reads `.env`. The optional `TEST_DATABASE_ADMIN_URL` must identify a local PostgreSQL server (defaults to the current OS user and `postgres` database). Each suite creates a randomly named `jlpt_f_acceptance_test_*` database, applies every checked-in migration, and drops only that database on completion. The existing HTTP harness similarly uses its own random `jlpt_v2_test_*` database. Tests never connect to production, reuse learning databases, call AI, or call Stripe's network API.

`ACCEPTANCE_STATIC_SNAPSHOT` must be a public-only snapshot with exactly `GrammarPoint`, `GrammarExample`, `GrammarRelationGroup`, and `TrainingScenario`. The snapshot is intentionally external; it has production entity IDs and Japanese originals needed for independent source binding. It contains no user/account tables. Content tests execute the actual scenario-preparation and translation-import CLIs, with the test database URL and dotenv disabled.

For content-only verification before A integration:

```sh
ACCEPTANCE_STATIC_SNAPSHOT=/absolute/path/to/public-static-content.json npx jest --config test/sentence-lab/jest.json --runInBand --runTestsByPath test/sentence-lab/content.acceptance-spec.ts
```

For a full typecheck of these tests and imported services:

```sh
npx tsc --project test/sentence-lab/tsconfig.json
npx eslint test/sentence-lab --no-fix
```

The Stripe duplicate-receipt test installs a 50 ms insert-delay trigger only in its disposable database for event IDs prefixed `evt_race_`. This makes the real PostgreSQL concurrent-insert race reproducible. It is removed with that database.

## Coverage and limits

- Quota: five/six mixed grammar+vocabulary task boundary, concurrent reservations, three/four successful+in-flight submission boundary, repeated request/completion/failure, payload conflict, account ownership, failed slot release and retry, timezone edits/concurrent rollover/skipped days, member expiration, historical exemption, restored tasks, free-before-reward accounting.
- Entitlements: exactly 24 hours and 365 days, exclusive expiration, concurrent renewals, duplicate grants, refund preserving another source, dispute suspended time/restoration, 90-day exclusive launch price boundary, USD/JPY units, fixed/idempotent gift with no order/admin mutation, live/test segregation.
- Checkout: server-owned USD/JPY pricing, concurrent idempotency, fixed return URLs, one-time purchase mode, no entitlement from checkout creation, and immutable 30-minute launch quotes across the 90-day cutoff.
- Stripe: real signature verification, concurrent duplicate event receipt, refund before completion, stale failed event, partial refund, dispute/won, provider outage/retry, authoritative owner/amount/environment mismatch, private order reads/cursors.
- Content: 223 grammar + 223 examples + 6 relation groups + 94 scenarios = 546; exact current source hashes; actual idempotent import; preserved Japanese/Chinese fields; hidden reference redaction and explicit reveal; stale Japanese example and Chinese explanation rejection.
- HTTP: production OriginGuard and session enforcement, exact raw-body Stripe signatures, account-private orders, and immutable grammar/vocabulary locale snapshots after preference changes.
- Memory evidence: actual HTTP admission and worker persistence, three vocabulary answers with immutable first evidence/FSRS, three grammar assessments followed by concurrent completion and exactly one first-attempt event.

Independent purposive semantic source/translation judgments are recorded under `language-review/`; they are separate from automated structural checks and do not claim human linguistic certification.

Remaining release gates are recorded in `RESULTS.md`. Passing these tests alone does not authorize opening real sales. No Android, AdMob SSV, real-device, live-runtime AI, payment-fee or server-cost conclusion is made by these suites.
