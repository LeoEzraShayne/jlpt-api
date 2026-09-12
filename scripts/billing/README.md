# Billing W1 operations and verification

## Runtime configuration

`BILLING_ENVIRONMENT=test|live` (default test), `STRIPE_SECRET_KEY` (`sk_` or restricted `rk_` for the same mode), `STRIPE_WEBHOOK_SECRET`, and the fixed `FRONTEND_URL` origin are server-only. Never return or log credentials. Stripe SDK 22.6.2 pins stable API `2026-08-26.dahlia`.

Supported optional mappings: `STRIPE_PRICE_DAY_USD`, `STRIPE_PRICE_DAY_JPY`, `STRIPE_PRICE_YEAR_USD_LAUNCH`, `STRIPE_PRICE_YEAR_USD_STANDARD`, `STRIPE_PRICE_YEAR_JPY`. Live Checkout requires a mapping. Test can fall back to inline `price_data`. The server snapshots the mapped price ID with amount/currency/duration; validates active, one-time, currency, amount and mode before Checkout. No frontend-provided price IDs/amounts/return URLs.

BillingConfig `default` must be explicitly created by controlled deployment. Defaults stay OFF. `launchAt` is the one global launch instant; `enforcementAt` is the first quota enforcement instant and must never be reset. A temporary sales/enforcement shutdown preserves these timestamps and all financial/learning rows. Never enable live charging before D/F cost and quality acceptance. There is deliberately no public activation endpoint.

Register `/api/v1/billing/webhooks/stripe`, with raw bytes and signing-secret verification. Event types: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`. Unsupported events are acknowledged without grant changes. The sole OriginGuard exemption is the exact POST webhook route.

Webhook processing reads authoritative provider state outside database transactions, then verifies a durable per-order processed-event revision under the User lock. Concurrent commits cause the provider state to be re-read. Same timestamps and reversed delivery order therefore cannot revive refunded/disputed grants. Receipt IDs, order IDs, source IDs, account request keys and submission keys are unique. Retryable reconciliation returns non-2xx. Financial payload storage contains object IDs only, not customer/payment payloads. Partial refund records the refunded amount and retains access; full refund revokes the source; disputes suspend remaining service and a won dispute restores it. Test and live grant sources are isolated in membership and renewal queries.

Checkout quotes expire 30 minutes after creation. Quotes begun before the exclusive 90-day launch boundary retain their amount during that payment window; new quotes after it use standard pricing. Orders are never granted from a success URL. Membership length is exactly 86400 or 31536000 seconds and renewal preserves remaining time. The launch gift is one fixed interval keyed `launch-vip:leo.ezra.shayne@gmail.com`, materialized on membership/quota access, without an order or role change.

## Quota/worker interface

`QuotaService` is global and exported through BillingModule. All write calls are used within the caller's Prisma transaction and acquire the User row first:

- `authorizeTask(tx,userId,kind,taskKey)` reserves once; restore/retry reuses its authorization.
- `authorizeSubmission(tx,userId,kind,taskKey,requestKey,payloadHash?)` reserves a correction slot, returns an existing outcome idempotently, rejects changed payload/owner.
- `completeSubmission(tx,submissionId,resultId?)` atomically consumes the task on the first success and the successful correction slot.
- `failSubmission(tx,submissionId)` releases unsuccessful slots and unconsumed task reservations.
- `releaseTask(tx,userId,kind,taskKey)` releases only an unconsumed reservation with no active submissions.

Daily free tasks and permanent reward credits use one serialized account. The daily allowance is 5; a task has 3 successful/in-flight corrections for nonmembers. Member requests are uncapped but remain idempotent. Successful member corrections remain counted when membership expires. A timezone edit never changes the currently issued period; its transition period is never shorter than the old timezone's next full day, and later periods follow the new zone's calendar/DST midnights. There are no missed-day backfills. Reservation reconciliation runs each minute, releases terminally failed jobs, and expires idle reservations after 24 hours only when no work is active. Reopening an expired task reauthorizes it. Historical tasks before enforcementAt are exempt.

Grammar submission accepts optional requestKey (UUID recommended); omission derives a compatibility hash of session/sentence/scene. Clients should use a new key for each intended submission and retain it for network replay. TaskSubmission.resultId is the grammar AiReviewJob ID. The AI worker completes/fails quota inside the same lease-fenced result transaction. Internal transient worker retries retain the existing slot; terminal failure releases it.

Each independently created VocabularyPractice uses one task and its own three successful corrections, even when linkedStudySessionId supplies grammar context. Vocabulary diagnosis inside an ordinary grammar correction never creates an extra task.

Vocabulary corrections use the same `/vocabulary-practices/:id/answer` endpoint after COMPLETED. Each response's top-level status/answer/result presents the newest attempt, while `reviewAttempts` retains all ordinals/outcomes. VocabularyPractice answer/assessment remain the first successful evidence; later corrections never change FSRS. `firstAssessment` exposes that baseline. QUEUED attempt is presented as ASSESSING at the top level. Session and vocabulary explanationLocale are immutable creation snapshots.

## Tests and observed sandbox result

`npm test -- --runInBand`, `npm run test:integration`, `npm run build`, `npm run check:lines`, and targeted ESLint. Integration harness creates/discards local-only temporary Postgres databases and now includes real BillingModule injection.

At W1 delivery: build, 380 unit tests, 63 integration tests, targeted ESLint, diff whitespace and the 500-line source limit all pass.

Additional database coverage includes sixth-task concurrency, three pending/successful correction slots, failed-slot recovery, idempotent success, cross-account denial, reward retention/reclaim, DST/timezone edits, historical exemption, member expiry, renewal/source suspension and restoration, gift idempotency, test/live isolation, 90-day pricing, same-second stale provider snapshots, duplicate events, partial/full refunds and same-task vocabulary memory immutability.

On 2026-09-13 JST the main agent completed Stripe Sandbox Checkout with the official test card. Order `cmtyj6i130001uhpscreofd3y` was USD 99 minor units and produced exactly one 86400-second grant. A signed three-way duplicate replay kept one grant. A real Stripe test refund of 20 cents produced PARTIALLY_REFUNDED with ACTIVE access; refunding the remainder produced REFUNDED with exact total 99 and REVOKED source. No live charge occurred. The return page requires W2 Web/API localhost integration.

The two scripts here intentionally guard the main agent's isolated payments test database and test mode. They read local protected `.env`; neither prints secrets. `create-sandbox-checkout.ts` creates a sandbox test user and quote. `verify-sandbox-refund.ts <paid-order-id>` replays the original signed test event and performs authorized partial/full sandbox refunds. Do not run these scripts against production.

Android Google order verification and AdMob SSV remain the explicitly scheduled A0/A1 scope; no fake Android/ad-credit endpoint is exposed in W1.
