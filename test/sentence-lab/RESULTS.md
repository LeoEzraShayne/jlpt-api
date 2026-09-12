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
