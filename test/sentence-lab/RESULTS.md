# F independent verification evidence

## 2026-09-13 — preparation / static corpus

Baseline: W0 schema + C corpus `ba34d3e` (no A billing code in checkout at first run).

Executed with local PostgreSQL and the public-only production source snapshot supplied by main:

- `content.acceptance-spec.ts`: **4 / 4 passed**, 2.837 seconds.
- Applied all formal migrations into a fresh random test DB.
- Loaded 223 grammar, 223 examples, 6 relationship groups, and 62 source scenarios; actual preparation CLI produced 94 total scenarios.
- Actual import CLI ran twice: **546 rows**, full current-source correspondence, no changed original grammar/example content.
- Hidden English/Chinese grammar reference fields redacted; explicit reveal returns references.
- Mutated Chinese explanation and Japanese example sentence independently return STALE with null localized fields; rollback restores source.

The first test setup run hit pre-seeded scenario IDs from migrations. The test loader was corrected to upsert the snapshot rows, matching the expected migration/import sequence. This was a fixture issue, not a production content defect.

Dependency install initially stopped at Prisma generation because the acceptance checkout intentionally had no `.env`; explicit nonsecret local placeholder `DATABASE_URL` allowed generation without a DB connection. No secrets or protected configuration were copied.

Billing, Stripe, and memory-evidence suites are **prepared, not yet run** at this checkpoint because A code is awaiting integration. No false pass is recorded. Targeted content/database ESLint was run independently; full-test ESLint must follow A integration to resolve its imports.

## Required follow-up gates

1. Run all prepared suites against main's integrated A/C code, report real failures to A, then rerun fixes.
2. Exercise actual Checkout creation/30-minute quote crossing the 90-day cutoff and unchanged old-order snapshot. Current catalog boundary tests alone do not prove provider quote behavior.
3. HTTP end-to-end origin/auth/raw-body checks and saved zh/en session snapshots, including preference changes/history.
4. Independently review static translation meaning/negation/register samples. Structural and hash correctness do not certify all linguistic content.
5. D/F independent live zh/en grammar+vocabulary quality and full AI cost accounting, including generation, reasoning/cache, failed/retry calls, unknown usage uncertainty, provider fees and server costs.
6. Main's actual Stripe sandbox end-to-end evidence and live configuration checks; no local simulator test substitutes for external delivery.
7. Android phase: Google cross-platform purchases/ownership, SSV duplicate rewards, pending/refund/restore, exact signing/version upgrade, device interactions, consent and real store release state.

## 2026-09-13 — integrated A/C independent acceptance

Tested main integration `9d0bc70` + documentation `ccd16b6` (local cherry-picks `8cde45e` + `4f8560e`). No business implementation was changed by F.

Final command: `ACCEPTANCE_STATIC_SNAPSHOT=<public-only snapshot> npx jest --config test/sentence-lab/jest.json --runInBand`.

**31 passed / 1 failed / 32 total; 5 suites passed / 1 failed; 5.05 seconds.**

| Suite                                    | Result       |
| ---------------------------------------- | ------------ |
| Quota                                    | 7 / 7 passed |
| Entitlements                             | 8 / 8 passed |
| Checkout                                 | 2 / 2 passed |
| Memory evidence through HTTP and workers | 2 / 2 passed |
| Static corpus import and presentation    | 4 / 4 passed |
| Stripe signature/reconciliation          | 8 / 9 passed |

`npx tsc --project test/sentence-lab/tsconfig.json` and `npx eslint test/sentence-lab --no-fix` both passed. The dedicated typecheck includes app declaration files and imported service dependencies, without unrelated legacy test files. A broad repository `tsc --noEmit` also identified pre-existing mock typing errors in `src/ai/progressive-review.spec.ts` and A's `test/learning-v2/billing.integration-spec.ts`; these do not originate in F tests and are outside F's write boundary.

Added Checkout evidence confirms server-priced JPY 6,400 for an English UI, one-time Checkout mode, allowlisted return origins, concurrent replay sharing one order, no grant from Checkout creation alone, and a USD 64 quote retaining its immutable 30-minute snapshot across the exclusive 90-day cutoff while a new quote costs USD 99.99. These are actual application service calls with a provider simulator; external Stripe acceptance of the expiry timestamp is still a separate sandbox gate.

Quota verification includes real concurrent mixed grammar/vocabulary admission and completion transactions. Member corrections exceed the free three-review boundary, and subsequent expiration cannot create extra free corrections. Failed submissions release daily/reward reservations. Current-period timezone changes do not issue a second allowance; simultaneous rollover issues one period. Historical and restored completed tasks do not consume a new allowance.

Actual vocabulary worker results preserve the first answer, first assessment, completion timestamp, counted evidence and the entire vocabulary learning/FSRS record after two corrections. Grammar completion after three reviews retains the first score and creates exactly one review event despite four concurrent completion requests. Test fixtures were corrected to supply required source metadata and a valid `NEEDS_REVISION` result enum; assertions now verify every grammar job completed before inspecting evidence.

### F-001 — duplicate Stripe event receipt insertion race (open)

- Owner: A; reported to main for assignment. F did not edit the implementation.
- Location: `src/billing/stripe-webhook.service.ts:27`, initial `billingEvent.upsert({ update: {} })` before the outer reconciliation try/catch.
- Reproduction: `stripe.acceptance-spec.ts`, `concurrent duplicate verified events create one grant and one durable receipt` sends six independently verified copies of one event ID concurrently into the real service and PostgreSQL.
- Observed without injected latency on the first full run: Prisma `P2002` on `(provider, environment, eventId)`. A subsequent normal-speed run happened to pass, establishing a race rather than a deterministic input failure.
- The final regression fixture installs a **test-database-only** `BEFORE INSERT` trigger adding 50 ms for event IDs beginning `evt_race_`. This ensures overlapping receipt inserts under realistic slow writes. It does not mock database operations, change application code, or delay unrelated events.
- Final observation: **1 delivery fulfilled, 5 rejected**. Earlier direct rejection stack identified the above `P2002` unique conflict. `Promise.allSettled` waits for every transaction before cleanup.
- Impact: simultaneous valid duplicate notifications receive avoidable server failures instead of idempotent success. One receipt may process correctly; the test does not claim duplicated grants or permanently lost payments.
- Required fix: atomic insert-on-conflict or explicit uniqueness-conflict recovery that re-reads the existing durable receipt and continues its reconciliation. Do not mask retryable reconciliation failures with a success response.
- Acceptance: all six valid deliveries succeed; exactly one processed receipt and one grant; rerun the full suite after main integrates the fix.

Real sales remain gated on this regression fix and the independent D/F live AI quality/cost acceptance. No claim of live sales enablement or Android acceptance is made.

## 2026-09-13 — F-001 independent recheck and W2 language/HTTP gates

Main integrated A fix `5a78f2b7072f671aa45ddc3edfaefa9f8e1dc732` (main `de8228e`, F local `e5d454c`). F independently reran all **32 / 32 tests passed**, 6 suites, 4.695 seconds. The 50 ms real-PostgreSQL receipt-insert race now succeeds for all six deliveries while preserving a single receipt and grant. **F-001 is closed.** No F business-code change was made.

Added HTTP tests instantiate real Nest controllers/services/guards with `NODE_ENV=production` in isolated local PostgreSQL, use the production raw-body bootstrap order, and never import AppModule/.env or call an external provider. They check bad/missing Origin on authenticated billing writes, required login, exact callback-only exemption, exact-byte Stripe signatures including whitespace versus reserialized JSON, rejected test/live mismatch, private order detail/cursors, independent UI/explanation preferences, persisted old grammar/vocabulary language snapshots, new-session preference adoption, and rejected unsupported language.

Static semantic review is separately **not passed**: 62 targeted records reviewed, 57 passed, one advisory, four defects. Details and all inspected source pairs are in `language-review/FINDINGS.md` and `language-review/static-en-review.json`. These findings arise in original Chinese/Japanese content and are inherited by English translations; structural/source-hash completeness did not detect them. Main will assign C to propose corrected sources and reviewed hashes. No production content was edited by F.

F also independently inspected D's first live DeepSeek regression artifact and found an additional semantic miss: `report-generate/en` was automatically marked `passed:true`, but the generated prompt asks the learner to answer **in English**, violating Japanese practice. D acknowledged and will preserve the automatic result while recording the failed semantic review and adding a constraint/regression check. This is separate from the already-known incorrect 聞くながら acceptance. **Runtime language quality and cost acceptance remain pending.**

Final expanded automated run: **36 / 36 passed**, 7 suites, 4.926 seconds; dedicated TypeScript, targeted ESLint, and `git diff --check` passed. Automated success does not override the four open semantic findings above.

## 2026-09-13 F fourth round: corrected source and AI cost pre-review

C source correction `8b5cc2d` independently closes the four reviewed language errors and one advisory; see `language-review/RECHECK.md`. Two additional real Postgres correction tests cover pre-English and prior-English states, atomic drift rejection and repeat no-op. Existing 546-source coverage uses a distinct corrected snapshot; historical findings are preserved.

D `c32e91e` was independently examined with original token receipts and 12 previously undisclosed real synthetic calls. See `ai-audit/REVIEW.md` and executable Python recomputations. Cost arithmetic reproduces the disclosed annual stress losses and positive sampled daily-ticket cash contributions, with strict scenario/uncertainty qualifications. Held-out produced 11 structured feedback results and one charged score-sum rejection; all 12 requests are metered, actual paid estimate $0.002234844. No general JLPT accuracy claim or charging qualification is made. Follow-up qualification should measure the real bounded retry route including every rejected attempt.
