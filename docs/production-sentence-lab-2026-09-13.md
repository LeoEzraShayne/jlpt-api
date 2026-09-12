# Sentence Lab feature deployment — 2026-09-13 JST

The bilingual Web features, compatible shared backend, content translations and qualified bounded AI route are deployed at https://jlpt.meritledger.org. **This is a feature release, not completion of W3 commercial activation or the Android stage.** Sales, task-limit enforcement and rewards remain false. `launchAt` and `enforcementAt` remain null. The 90-day offer and designated 365-day gift have not started. No live Stripe products/webhook configuration or real purchase was performed for this release. The later owner-confirmed global USD revision supersedes the pricing-decision status and runtime version below; see [USD pricing and fees](contracts/usd-pricing-and-fees.md). Earlier deployment evidence remains chronological.

## Versions and service checks

| Component | Deployed version |
|---|---|
| API runtime | `c56194b1bb264a8b1584d5b023603323473b9337` |
| API release directory | `/var/www/jlpt-releases/c56194b1bb26` |
| Web | `d15947b9b3a15c09ab3dec9e4f64cca1980cddc8` |
| Cloudflare Worker `jlpt-web` | `0f23e8e8-a0ce-4f75-9f09-c6b82575f8ae` |
| Prior API directory | `/var/www/jlpt-releases/fa763aa` |
| Prior Web code / Worker | `3575ab98ab6aa362d4096bd2955ae4a16a6e55f6` / `fcbf141b-b2f7-4c06-b1bf-36f35ad2c2ba` |

The feature release initially deployed Web `adec807` as Worker `74a1b562-2cfb-440d-a9d0-cd8821c9921c`. The final small UI patch accurately describes disabled task limits instead of displaying an active-looking 5/5 allowance; enabled limits and actual membership identity retain their server-defined behavior.

The API source archive SHA-256 is `13ed6119eb156a518f6b11a6b0aa6098df19290ea5b4144ed2231feb816d7aaf`. The new release has independently installed dependencies and its own generated Prisma client. The old release and node_modules were retained. The existing `/var/www/jlpt-api` symlink was switched, PM2 `jlpt-api` reloaded and saved. Health and PostgreSQL connectivity passed; a subsequent check at `2026-09-12T17:03:47.290Z` returned healthy. The public catalog returned `salesEnabled:false`, `launchAt:null`, `launchEndsAt:null`.

Web was built using OpenNext with the production API URL and deployed through the existing Cloudflare account `9d2a9911ed118bef4f747712e92c4426`. No new hosting service or binding was introduced.

## Backup, migration and content

All backups remain under protected `/var/www/jlpt-backups` (directory 0700, dumps 0600).

| Backup | SHA-256 |
|---|---|
| `before-sentence-lab-20260913-w3.dump` | `9204b7074481cbc2a199b81974223afa92301eb9e1f1bcdd2ab9215cb1af91ae` |
| `before-sentence-lab-20260913-w3-activate.dump` | `e41086403f5dca8707a840aa058ae72601957654a7e9b455adfd7d34a05e1401` |

The W3 dump was fully restored with `pg_restore --exit-on-error` into isolated database `jlpt_sentence_lab_restore_20260913_w3`. The actual candidate's `prisma migrate deploy` and guarded content imports were rehearsed there. Thirty pre-existing business tables retained matching deterministic fingerprints over their old columns; Prisma migration metadata was excluded. Earlier W2 backup/restore evidence remains preserved.

A fresh activate dump was taken and inspected immediately before production migration. Production `prisma migrate deploy` successfully applied `202609130001_sentence_lab_foundation`. Before/after fingerprints of all 30 pre-existing business tables matched (`w3-production-before.tsv` and `w3-production-after.tsv`). Subsequently, the intended guarded static corrections changed five source rows, prepared 82 catalog scenarios and imported **546/546 current validated English entries, zero gaps**: 223 grammar, 223 examples, 6 relations and 94 scenarios. Coverage is recorded in `w3-production-content-coverage.json`. No synthetic sandbox learning history, test orders or evaluation fixtures were imported.

## AI and validation

Production explicitly selects DeepSeek Flash with low thinking for grammar and thinking disabled for vocabulary; grammar output cap is 4096 tokens. Gemini fallback is unconfigured in this release. The original protected configuration is preserved; no key was revoked or IP restriction removed. Numeric thinking usage is counted within completion tokens once; thought contents are not stored in the audit.

Each round has two provider-call slots. Atomic round admission bounds automatic recovery to six calls, or eight including the existing final manual retry. Expired/overlapping workers cannot reopen ordinals, overwrite a newer result or consume quota twice. This bounds job recovery, not member learning activity.

- Integrated API: **409 unit tests, 68 database integration tests**, build and TypeScript checks passed. The deployed API commit's [CI passed](https://github.com/LeoEzraShayne/jlpt-api/actions/runs/34705979706).
- F: **49 independent tests** passed. Test-only acceptance commit `9fd7f7e` follows the deployed runtime commit without changing production implementation.
- Final Web: **64 tests**, typecheck, lint, line checks and the production OpenNext build passed. [Final Web CI](https://github.com/LeoEzraShayne/jlpt-web/actions/runs/34707047214) records remote validation.
- F's frozen real-provider batch: **24 operations, 27 requests, 27 unique PostgreSQL usage receipts**. All final core semantics/structure passed, including repaired responses. One imprecise vocabulary explanation clause remains a documented non-blocking advisory for feature publication with charging disabled. This is bounded evidence, not comprehensive JLPT accuracy or human-linguist certification. See [full evidence and cost calculations](../test/sentence-lab/ai-audit/route-held-out/MIXED-REVIEW.md).
- Real sandbox browser/payment checks covered successful Stripe test payment, webhook entitlement, partial/full refund, English grammar, three vocabulary corrections and rejection of a fourth without altering the first memory evidence. No actual money was charged.
- Production Chrome checks verified restored existing authentication, bilingual navigation/profile, English dashboard explanations, and immutable Chinese feedback in an old history entry despite English preferences. Both owner language preferences were restored to Chinese afterward. No production assessment or study completion was submitted during this smoke check.

## Unresolved commercial gate and next stage

At 240 corrections/day with half vocabulary and a fresh question per vocabulary correction, qualified-route samples imply roughly **$157–201/year AI cost** at peak/cold pricing. Original launch-year proceeds after modeled payment fees are about **$59.78 USD** or **$40.70 equivalent for JPY6,400**, before fixed hosting and free-user costs. Heavy grammar use can also exceed the original daily-pass proceeds. These are conditional stress scenarios, not expected annual usage forecasts; historical higher costs and unknown expenses remain visible in F's report.

The owner has been asked to choose repricing with unlimited use, keeping the original price/unlimited benefit while accepting subsidy, or leaving charging off. No answer is recorded yet. Do not add hidden limits, invent new prices, create live commerce configuration or start either launch clock on an assumption.

Android remains at [read-only preflight](contracts/android-readonly-preflight.md): original package/signatures/version and visible Play products/orders were inspected, with no Android implementation, product edits or store submission. Proceed according to the approved staged plan after resolving the Web commercial gate.

## Recovery

Keep all new learning, orders, entitlements and migration tables. Prefer a compatible code/configuration fix; close new sales/rewards if needed while honoring valid membership. Previous code and Worker versions are preserved, but check compatibility before rollback. Never restore a stale database dump over post-backup learning or payment records as routine code rollback. Disaster recovery requires a current backup and reconciliation of later records. Protected PM2/configuration backups contain secrets and must not be printed or committed.
