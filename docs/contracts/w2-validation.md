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

## Subsequent W2 findings and corrections

- F added HTTP origin/authentication/raw-signature and immutable language-snapshot tests: **36/36 acceptance tests passed** before the subsequent card-only quote additions. Static semantic review is separate: 62 stratified samples yielded 57 passes, one advisory and four failures inherited from source content. C is correcting source connection rules, a reversed-negation example and associated English artifacts; the language gate remains open.
- `27fcb6a` adds batch localization to dashboard task grammars and the review queue, without altering scheduling. Web `0e2cfd6` consumes these fields and fixes saved-language bootstrap text/document titles. Main verified English dashboard explanations and that changing explanation preferences leaves an existing English study session unchanged.
- Integrated main checks passed: API 380 unit tests / 63 database integration tests; Web 58 tests and typecheck. API `afbe1b9` and Web `82dd330` were pushed and both GitHub CI runs passed. Newer fixes require their own final CI after integration.
- New Checkout quotes persist a `CARD_ONLY_V1` policy snapshot (`dae88f4`) and explicitly allow card payment. Pre-existing quote retries retain the original request parameters. This constrains the actual payment surface to the processing-rate assumptions without changing account-wide methods or existing orders.
- Gemini server evaluation used protected independent temporary directories, synthetic inputs and fsynced file receipts. No production Prisma instance/database connection was used. The first 56-call comparison returned 28 HTTP 404s for 2.5 Flash Lite; 3.5 Flash returned 25 HTTP 429s, one invalid response and two valid responses. Invalid responses with returned usage still incur modeled paid cost.
- One subsequent metered diagnostic identified `GenerateRequestsPerDayPerProjectPerModel-FreeTier` with quota 20. AI Studio independently shows the JLPT production key's project on the free tier; an existing billing account has no configured prepayment method. No billing upgrade or payment was performed. A later bounded 3.1 Flash Lite comparison made 14 calls (11 valid responses, two invalid responses, then HTTP 429 and stopped). A valid response does not itself mean semantic acceptance.
- Cloudflare Workers account settings report the Standard usage model. Existing OAuth cannot read subscription invoices (HTTP 403), so actual billing is unverified. Conservatively include the [published Standard $5/month baseline and overage rates](https://developers.cloudflare.com/workers/platform/pricing/) in the economic model, in addition to CNY 40/month server cost; do not assume free hosting indefinitely.
