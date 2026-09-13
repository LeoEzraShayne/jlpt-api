# Web billing and Gemini free-first live — 2026-09-13 JST

Web charging is enabled, the owner's 365-day membership is active, and the qualified Gemini free-first / DeepSeek fallback configuration is running in production. No real-money purchase was performed during acceptance.

## Running versions and preserved data

API runtime: `2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`, `/var/www/jlpt-api` now points to the matching isolated release. Existing PM2 `jlpt-api` was reloaded with the protected environment and saved; status online. HTTP health reports database OK. Web remains `05faa3ecfe8741e6a55c2cd50801ddbf5322f3dc` (Worker `46a81ff6-1608-43c7-b1d3-4471e1b0eda1`).

Backup, migration, retained 1,237 IDs, Stripe product IDs, free-tier project verification and passing CI are recorded in [preparation evidence](production-web-live-prepared-2026-09-13.md). There was no second migration or database restore. Credentials reside in mode-600 backend configuration; the temporary server credential-transfer files were removed.

## Actual live payment evidence

- The restricted runtime key reads all three live prices and creates card-only Checkout without broader account permissions. Account status UI showed Payments and Payouts Active, no outstanding tasks.
- Webhook `we_1UF0OfKId1Bt4Wq3LVDDM0ww`, snapshot API `2026-08-26.dahlia`, delivered actual live expiration event `evt_1UF0mzKId1Bt4Wq3ZCdzBXdb`. Stripe displays Delivered / HTTP **201**, response `received: true`; the matching backend BillingEvent is live / PROCESSED. This proves actual signing-secret match and delivery, not a paid purchase.
- After activation, the owner's Web year-card button created an actual USD 64 Checkout, displayed US$64.00 on Stripe, with a 3,599-second provider quote interval. No payment details or OTP were entered. We returned without paying and expired that session.
- Application order `cmtz1qiqv00011ivb21y79d66` is live / USD 6400 / EXPIRED; its live expiration webhook is PROCESSED. Web order history shows the same expired order, and the launch gift is unaffected. The unpaid acceptance order was retained rather than deleted or relabeled paid.
- One initial membership catalog fetch timed out; the existing retry button loaded the correct catalog. Subsequent return and order-history checks succeeded.
- Real paid settlement, refund and dispute paths have automated/sandbox coverage; no actual customer charge/refund/dispute was executed in this acceptance.

## Immutable activation result

| State | UTC | Japan time |
|---|---|---|
| Launch / enforcement starts | 2026-09-12T23:58:15.676Z | 2026-09-13 08:58:15.676 |
| Shared 90-day launch offer ends | 2026-12-11T23:58:15.676Z | 2026-12-12 08:58:15.676 |
| Owner gift ends | 2027-09-12T23:58:15.676Z | 2027-09-13 08:58:15.676 |

`salesEnabled=true`, `enforcementEnabled=true`, `rewardsEnabled=false`. Public live catalog returns day USD 99 cents and launch year USD 6400 cents; later new annual quotes use USD 9900 cents. Activation was performed once with `alreadyActivated=false`.

`leo.ezra.shayne@gmail.com` has the single ACTIVE `LAUNCH_GIFT` from launch for exactly 365 days. The Chinese member page shows its exact expiry and unlimited normal learning with no hidden daily cap. No fake paid order or administrator privilege was granted.

## Active provider and next stage

PM2's safe configuration check confirms `GEMINI_FREE_FIRST=true`, `GEMINI_MODEL=gemini-3.8-flash`, `DEEPSEEK_MODEL=deepseek-flash`, thinking effort low and scope grammar. The actual free-tier key remains IP restricted. [Independent bounded quality evidence](../test/sentence-lab/ai-audit/gemini-free-first/FINAL-REVIEW.md) covers grammar, vocabulary assessment and generation in both languages and retains failures/cost uncertainty. This is not a claim of perfect accuracy or zero provider outages.

Android A0 has resumed: E is building the independent TWA skeleton and A is designing binding, Google Billing and AdMob SSV contracts. No Android release, Google product, paid purchase or production advertisement has been enabled by this Web launch.
