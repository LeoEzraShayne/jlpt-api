# JLPT Sentence Lab v1 — W0 locked contract

Approved source: user plan, 2026-09-13. Main agent owns this document, Prisma schema/migrations and shared API types. Changes require coordination, not independent schema edits.

## Baseline and rollout
API fa763aa8219adbd1b52d121ed776d8510776b6a4; Web 3575ab98ab6aa362d4096bd2955ae4a16a6e55f6. Both clean. API production symlink /var/www/jlpt-releases/fa763aa; PM2 jlpt-api online. Stripe Leo Shayne Studio account confirmed read-only; live charge capability not yet verified. Android identity com.meritledger.app requires Play highest-version, signing, existing-order verification in A0.

W0 contract -> W1 A/B/C -> W2 D/B/F -> W3 acceptance and launch -> A0–A3 Android. Purchases and enforcement default OFF until quality/cost acceptance. No historical quota charging. Additive migrations only. Never regenerate Prisma inside shared production node_modules. New backup, restore rehearsal, independent release dependencies before deployment. Rollback disables new sales, preserves all orders/grants/learning records.

## Prices and membership
Identifiers DAY_PASS and YEAR_PASS. USD amounts in cents: 99, launch 6400, standard 9999; JPY amounts in yen: 100, 6400. Durations exactly 86400 and 31536000 seconds. No subscriptions. Market JP uses JPY; GLOBAL uses USD, language never decides currency. Server derives prices and immutable order snapshots; never trusts supplied amounts or duration. BillingConfig singleton `default` has launchAt nullable and salesEnabled false. launchEndsAt = launchAt + 90*86400 seconds (exclusive). Test launch dates isolated from production. Unpaid Checkout expires no later than launch price cutoff; late paid orders retain their recorded quote.

Verified paid orders create one EntitlementGrant per sourceKey, with startsAt=max(paidAt,current valid entitlement tail) and endsAt=startsAt+duration. Serialize per user. Refund/chargeback only revokes/suspends that source; recalculate surviving future grant intervals without erasing purchased duration or consumed historical service. Partial refund retains membership pending explicit policy; record amount, never silently revoke full entitlement. Dispute won restores source without duplicating time. Order financial state must not regress due to delayed events. Query provider authoritative state where needed. Provider order IDs and event IDs unique. Test/live isolated by environment and runtime key checks. Promo gift key `launch-vip:leo.ezra.shayne@gmail.com` starts at launchAt, lasts 365 days, idempotent, no fake order/admin promotion; if account absent grant on first authenticated appearance or controlled retry.

## HTTP (existing {data} envelope; existing error envelope)
- GET /billing/catalog?market=JP|GLOBAL : Catalog (public)
- GET /me/entitlements : MembershipSummary (authenticated)
- GET /billing/orders?cursor=&limit= : {data:OrderSummary[],meta:{nextCursor}}
- GET /billing/orders/:id : OrderSummary owned by current account
- POST /billing/checkout {productCode,market,requestKey,locale} : {orderId,checkoutUrl}; idempotent per account+requestKey; hosted Stripe payment mode; fixed allowlisted return URLs /membership/return?orderId=... and /membership. No client-supplied URL. Auth + origin protection.
- POST /billing/webhooks/stripe : raw request bytes + verified signature. Exact route exempt from browser OriginGuard only, never general billing exemption. Durable event receipt, transactional grant, non-2xx on retryable failure.
- PUT /me/preferences accepts uiLocale and explanationLocale: zh|en in addition to existing fields. GET /me returns them.
- GET grammar/scenes/content preserve legacy fields, add localized fields or translations keyed zh/en. Resolve requested language deterministically and expose missing translation; no pretending Chinese fallback is English.

## Quota and tasks
Free daily grammar LEARN/REVIEW/PRACTICE and standalone vocabulary practice total 5 tasks. Each has 3 SUCCESSFUL assessments. Members unlimited normal tasks/assessments, no hidden caps. Existing safety/abuse protections must not masquerade as paid usage caps. Old sessions predating enforcement stay exempt. Rewards do not expire; consume daily free first, then reward. Web never offers ads.

QuotaService exported from BillingModule owns authorizeTask(tx,userId,kind,taskKey), authorizeSubmission(tx,userId,kind,taskKey,requestKey), completeSubmission(tx,submissionId), failSubmission(tx,submissionId), releaseTask(tx,userId,kind,taskKey). Concrete method signatures may be adjusted once between A and D with main approval; semantics fixed. kind GRAMMAR or VOCABULARY, taskKey is persisted session/practice ID. Main user row SELECT FOR UPDATE locks order: User -> quota -> task -> submission. Never hold DB transaction across AI/provider network requests. Admission reserves one task, first successful assessment consumes reservation atomically with persisted result. Failure releases unsuccessful submission slots and unconsumed task reservation; retry must atomically reauthorize. Duplicate requestKey returns original outcome, never repeats AI or charges. Count successful + in-flight submissions for 3-slot admission; unlimited member path still idempotent. Restore existing tasks never double charges. Expired member resumes task using free task's total successful count; previous member successes cannot unlock extra free corrections.

QuotaPeriod has immutable timezone, startsAt/endsAt, reserved/consumed counters; QuotaAccount points to current period. Initial period ends at next midnight in account timezone. Timezone edit does not change current period/reset. On expiry new period uses current timezone and monotonically advances period end (never backfills missed days). Locks prevent duplicate reset; 5 allowance maximum per current issued period. No quotas alter pending StudyTask rows or FSRS dates. Reservations expire/release safely only with no active jobs; restored task must reauthorize.

VocabularyPracticeAttempt stores each answer/assessment/requestKey/status/ordinal; VocabularyPractice existing answer and assessment remain first successful evidence, and counted memory update only once. Correction attempts do not reschedule memory. Grammar existing first-attempt evidence rules remain.

Error codes: DAILY_TASK_LIMIT (402), TASK_REVIEW_LIMIT (402), BILLING_DISABLED (503), PAYMENT_UNAVAILABLE (503), REQUEST_IN_PROGRESS (409), IDEMPOTENCY_CONFLICT (409). UI uses codes with localized text and preserves user input/task state.

## Language/content
User.uiLocale=zh and explanationLocale=zh defaults. StudySession and VocabularyPractice explanationLocale snapshot at creation, never rewritten on preference change. AiReviewResult explanationLocale + localizedFeedback JSON can carry English alongside legacy Chinese-named fields. ContentTranslation unique entityType/entityId/locale/sourceHash; fields JSON contains translated explanation/connectionRule/usageScene/commonErrors, example translation, scenario domain/objective/register/prompt, relation title/notes as relevant. status DRAFT|VALIDATED; provenance model/provider/sourceHash/validatedAt. Japanese stays Japanese. VocabularyEntry.glosses original English preserved; chineseGloss and chineseGlossSource preserved.

C owns API content-localization module + scripts/content-localization + translation artifact data, and additive read integrations in grammar/scenes/content only. B owns all Web UI translation dictionary resources and pages; C may provide terminology reference but must not edit B's files. D owns runtime AI language/provider/metering, not static translations. Main owns preference endpoint and schema. No redundant correction expansion or expression-favorite cards restored.

## AI usage
AiUsageRecord records EVERY provider call, including failed/retry/vocabulary generation/assessment/static translation: purpose, provider, model, requestId, userId/taskKind/taskKey, attempt index, success, errorCode, inputTokens, outputTokens, thinkingTokens, cachedInputTokens, cacheWriteTokens, totalTokens, usageComplete, latencyMs, costUsd Decimal, pricingVersion, rawUsage JSON (usage fields only, no prompts/keys). Unknown token fields NULL, never false zero. Provider semantics must avoid double counting reasoning already included in output. Persist attempt usage before another retry; metering failure observable. Costs include unknown/failed usage uncertainty.

Acceptance: actual live zh/en grammar + vocabulary quality regression, ordinary 20–40 and heavy 120–240 corrections/day, generation/reasoning/cache/retries/payment fees/server costs. Current official prices cited. Free allowances never perpetual zero-cost assumption. No live sales until D/F independently confirm feasibility or user resolves material cost conflict.

## Deliveries and isolation
A: API billing + admission/task wiring + vocabulary correction storage, own worktree, no schema/shared types. B: Web components/pages/UI locale dictionary, own worktree, no shared types. C: API static translation modules/import/validated corpus, own worktree. D/F/E/G staged later, max three active child agents. Only main handles authenticated browser, shared schema, production and platform accounts. Deliver commit SHA, summary, interface impacts, checks, schema requests, remaining issues. No secrets in reports or commits.
