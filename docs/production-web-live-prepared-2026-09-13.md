# Web live release prepared — 2026-09-13 JST

The candidate is prepared on the production server; **it has not replaced the running API and sales are not active**. The signing-secret handoff is pending. This record is not a payment-success or launch-activation receipt.

## Verified candidate

- API candidate: `2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`, pushed to main. [CI passed](https://github.com/LeoEzraShayne/jlpt-api/actions/runs/34725989131).
- Local build/type check, 426 unit tests, line checks and dependency audit passed (zero vulnerabilities). F's independent final acceptance is 70/70 plus four PostgreSQL route tests; see [final provider review](../test/sentence-lab/ai-audit/gemini-free-first/FINAL-REVIEW.md).
- Gemini 3.8 Flash has real successful samples for grammar review, vocabulary assessment and generation in Chinese and English. Bounded evidence: 22 operations, 28 receipts, 21 accepted final outputs and one isolated service operation rejected correctly. Known tokens repriced as DeepSeek peak/cold cost $0.0155898; five HTTP 503 calls have unknown usage. This is not a production success-rate estimate.
- Google AI Studio showed `jlpt-backend-gemini-prod`, project `diceroller-b89331d1`, at the free tier. Its displayed key suffix matches the retained protected server key. No paid tier or relaxed IP restriction was enabled.

## Stripe live configuration

Account `acct_1StQhPKId1Bt4Wq3` (Leo Shayne Studio): the Account status UI showed Payments and Payouts Active, with no active tasks. This is UI evidence, not an Account API capability response. The restricted runtime credential deliberately cannot read administrative Account/Webhook APIs; use the documented `--runtime-only` mode without treating its subset result as full readiness.

| Product | USD cents | Live price |
|---|---:|---|
| 24-hour day | 99 | `price_1UF0DgKId1Bt4Wq36sqF8yQs` |
| 365-day launch year | 6400 | `price_1UF0HLKId1Bt4Wq3BieXfmm9` |
| 365-day standard year | 9900 | `price_1UF0FFKId1Bt4Wq3C9lW4Sxq` |

All three prices were read back as active, one-time and live. The approved restricted runtime key successfully created one unpaid LIVE Checkout for the day price: USD 99 cents, card only, adaptive pricing disabled, automatic tax disabled. No card was submitted, no charge occurred, and no application PaymentOrder or member grant was fabricated. Its protected local receipt can be used to expire the session and verify a real delivery after the signing secret is configured.

Webhook `we_1UF0OfKId1Bt4Wq3LVDDM0ww` is Active at `https://api.jlpt.meritledger.org/api/v1/billing/webhooks/stripe`, snapshot API `2026-08-26.dahlia`, with all 15 events listed in `scripts/billing/check-live-readiness.ts`. The signing secret has not yet been saved into the prepared release; real signature/delivery verification remains pending.

## Server preparation actually performed

- Running symlink remains `/var/www/jlpt-releases/a9a064a0c45b`; PM2 remains `jlpt-api`, port 4500.
- Fresh custom PostgreSQL backup: `/var/www/jlpt-backups/before-web-live-2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4.dump`; archive listing passed. SHA256 `8953cff9aa372d443389e250e08bb0c1f2c09b99ffa8e3217f9679b5d07e11e9`.
- New isolated release directory: `/var/www/jlpt-releases/2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`. Its own npm ci, Prisma generation and build passed. The old release dependencies were not reused.
- The only pending migration, `202609130002_ai_provider_circuit`, was applied successfully. All 1,237 pre-existing IDs across the selected learning, user, order and entitlement tables remain present; protected before/after evidence is in the backup directory.
- The new release's mode-600 environment contains the approved durable Stripe runtime key, three live prices and accepted Gemini free-first configuration. These settings are **prepared, not active**. Signing-secret configuration is still absent.
- The current BillingConfig remains sales/enforcement/rewards off, with launch/enforcement timestamps null. No launch gift was issued. The existing Web deployment remains `05faa3ecfe8741e6a55c2cd50801ddbf5322f3dc`.

## Next required steps

1. Receive the user-saved webhook secret in the already prepared protected local file, validate format without printing it, transfer it to the new backend configuration and run runtime readiness.
2. Switch the exact prepared release and reload the existing PM2 process with the matching environment; verify health/auth/catalog/history.
3. Expire the unpaid LIVE Checkout (or resend its expiration if already expired) and verify Stripe delivery plus the server's processed event receipt. Do not perform an unapproved real-money transaction.
4. Only after these gates, execute the guarded activation command once, verify immutable launch and 90-day offer dates and the owner's exact 365-day LAUNCH_GIFT, then verify Web purchase/member behavior.
5. Resume Android only after Web launch is usable. Do not rerun preparation scripts or migrations blindly, and never reset launch timestamps.
