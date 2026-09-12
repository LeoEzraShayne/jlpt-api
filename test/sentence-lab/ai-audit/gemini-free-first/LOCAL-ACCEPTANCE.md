# F local Web launch acceptance, 2026-09-13 JST

**Operational acceptance: PASS on the integrated candidate. Live Gemini semantic acceptance remains pending a real server run and separate F reading.**

Implementation pins: global USD pricing `a9a064a`; stale checkout fix `deec872`; versioned expiry `d22731f`; shared circuit schema `93e480c`; Gemini route D `05c0179`; activation `bb5a888` plus `28fc6c8` and `a2adf60`. F worktree head at verification: `bd94049` (contains the same implementations plus independent tests).

All **69 independent acceptance tests in 13 suites passed**, each suite using a disposable real local PostgreSQL database. D's four real-PG circuit tests were independently rerun and passed. TypeScript, scoped ESLint and diff checks passed. No real provider, Stripe API, production database, key or browser was touched by F. The two pg client concurrent-query deprecation warnings are retained in test output and did not affect the assertions.

## Concrete launch evidence

The new launch boundary tests verify missing/future activation grants nothing early; exact activation grants once under eight parallel reads; the grant ends at exactly 365 days with an exclusive endpoint; a later sales shutdown or config write cannot extend an already-issued gift. The actual `activateWebBilling` function is also called directly by seven tests covering eight concurrent first activations, later repeats after a sales shutdown, missing-account rollback, future/conflicting timestamps and conflicting pre-existing gift rollback. One original launch/enforcement pair and one 90-day cutoff are retained, no fake order or administrator role is created, and rewards remain disabled.

F found two implementation defects before any activation: Prisma's empty-update upsert could race on a missing singleton (`P2002`), and the first advisory-lock repair returned PostgreSQL void through `$queryRaw`, which Prisma could not deserialize. Main fixed serialization before upsert and cast the lock result to text. Both defects were reproduced in disposable databases; all seven actual-function tests pass after `a2adf60`. Earlier failing runs are not relabelled as passes.

Global USD $0.99 / $64 / $99, exclusive 90-day cutoff, old currency/quote snapshots, stale Checkout links, versioned expiry, failed/duplicate/late payment events, environment separation, refund/dispute source isolation, 24-hour/365-day durations, stacked renewal and member access were covered by the complete independent suite. Live credential durability, matching webhook secret/delivery and actual live checkout readiness remain main-agent platform checks; these local tests do not claim a live customer purchase.

## Concrete AI routing/accounting evidence

An independent test drives the real `AiReviewService`, providers, `AiWorkerService`, quota service and PostgreSQL ledger with deterministic transport: a machine-readable Gemini day-quota 429 precedes a valid DeepSeek correction. There are exactly two unique receipts (failed Gemini has unknown cost; successful DeepSeek has complete usage including reasoning), exactly one successful correction, one consumed task and four remaining free tasks. A second worker poll creates no duplicate usage or task consumption.

A separate independent test overlaps the actual grammar and vocabulary services with one shared synthetic key/model. While grammar holds Gemini's database lease, vocabulary generation immediately uses DeepSeek; after grammar releases, the next vocabulary generation returns to Gemini. All three network calls have distinct complete receipts; there is no fabricated receipt for a skipped provider. This covers service constructor/database wiring across purposes, beyond the route-helper tests.

Existing F recovery tests remain green: six automatic calls, at most eight with explicit manual recovery, unique claimed attempt ordinals, stale claimant cannot replace a newer result, failed tasks release quota, and successful evidence is not counted twice. Member corrections remain uncapped by free-task limits. Deterministic provider content in these tests is operational evidence only, not a Gemini language-quality pass.
