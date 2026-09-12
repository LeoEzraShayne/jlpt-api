# W2 integration evidence — 2026-09-13

This is an in-progress acceptance record. Production sales and quota enforcement remain disabled; no production schema migration has been applied.

## Independent regression

F initially obtained 31/32 passes and reproduced a duplicate Stripe receipt insertion race under real PostgreSQL concurrency. A replaced the empty-update Prisma upsert with atomic insert-on-conflict and receipt lookup (`de8228e`, source `5a78f2b`). F independently reran all six suites: **32/32 passed**, including the deterministic 50 ms slow-insert regression. Extended HTTP and language/cost acceptance continues separately.

Main integrated Web vocabulary snapshot/history response handling as `82dd330`. B reports 54 tests, lint, typecheck, production build and file-size checks passing. Main's 390×844 Chrome check confirms the membership header, English allowance details, separate purchase-market control, immutable order history and remaining free quota after the fully refunded sandbox order. Local API restart was required after the previous test process ended; this was not a production outage.

## Backup and migration rehearsal

- Protected production backup: `/var/www/jlpt-backups/before-sentence-lab-20260913-w2.dump` (mode 600).
- SHA-256: `ce295408ca4b227e8388a075f21ca9a0734d4d839e6d0caffd297abbc35487da`.
- `pg_restore --list` and a complete `--exit-on-error` restore succeeded into isolated server database `jlpt_sentence_lab_restore_20260913` on PostgreSQL 16.13.
- Applied `202609130001_sentence_lab_foundation/migration.sql` inside one transaction **only to the isolated restored database**.
- Before/after row counts and deterministic hashes of all pre-existing columns match across **31 tables / 20,028 rows**. Added language defaults are Chinese as required; new PaymentOrder and TaskAuthorization counts are zero.
- A first rehearsal query had a quoting error before migration execution; corrected SQL then completed. No failed migration or partial schema state was left behind by that first query.
- Restore database remains isolated from the application. Production application continues to use `jlpt` and its existing release. Take another fresh backup immediately before eventual production migration.

Rollback retains all new tables and historical data. Disable new sales/rewards first, preserve valid member access, and use the matching prior API/Web releases only after checking compatibility. Never regenerate Prisma into the old release's shared node_modules or run a destructive down migration.

## Cost inputs and outstanding gate

Production API DNS resolves to the verified Tencent Lighthouse host. Its current renewal quote is **CNY 40/month or CNY 480/year**, for Tokyo zone 2, 2 vCPU, 2 GB memory, 40 GB SSD and 200 Mbps peak unlimited traffic. This is a current renewal quote, not an assertion about historical payment. The quote dialog was cancelled without purchase. Fixed cost must be allocated across paying and free users with exchange-rate sensitivity.

Stripe's actual sandbox Checkout displays the existing 1% Climate contribution. Include it with processing and applicable currency conversion fees. No contribution setting was changed.

DeepSeek real calls succeed. Gemini local regression is blocked by `API_KEY_IP_ADDRESS_BLOCKED`; this does not certify model quality or zero cost. Keep the existing IP restriction. Synthetic evaluation from the permitted server, with independent durable usage receipts and no production database access, is the next validation step. Live charging remains blocked pending D/F quality and full-cost acceptance.
