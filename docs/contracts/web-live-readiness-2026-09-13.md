# Web live billing readiness review

This is a source review and local acceptance record, not evidence that live
credentials, products, webhooks or charging have been activated. Android work
was paused under the owner's revised order of execution. The main agent alone
performs account, secret, production and activation operations.

## Verified implementation

- New quotes use USD 99 / 6400 / 9900 cents, one-time payment, card-only and
  Adaptive Pricing disabled. JP legacy inputs also quote USD; earlier order
  snapshots preserve their original currency and request parameters.
- The shared 90-day period starts at the one immutable `BillingConfig.launchAt`.
  Before that timestamp or while sales are disabled, new quotes fail closed.
- Signed raw-body webhooks re-read Stripe's current payment, charge and dispute
  state, validate application/user/order/currency/amount/environment, then write
  order, grant and processed receipt under the same user lock. A return URL does
  not grant membership. Refunds revoke only the affected source; duplicate and
  out-of-order delivery do not multiply grants.
- Existing code returned a stored Checkout URL before checking whether its order
  was paid, refunded, closed or expired. The review fixes this ordering. Replays
  now return `CHECKOUT_EXPIRED`; current pending quotes retain their URL.
- API SDK 22.6.2 pins `2026-08-26.dahlia` (read from the installed package).

## Concrete main-agent configuration and verification

1. Confirm the existing Stripe account `acct_1StQhPKId1Bt4Wq3` and its ability to
   accept card payments. Place a durable live secret/restricted key in protected
   production configuration. The temporary Stripe CLI login key is not evidence
   of a durable credential. Preserve existing OAuth/session/provider settings.
2. Create or reuse active **one-time** USD prices, keeping previous/test prices:

   | Setting | Amount in cents |
   | --- | ---: |
   | `STRIPE_PRICE_DAY_USD` | 99 |
   | `STRIPE_PRICE_YEAR_USD_LAUNCH` | 6400 |
   | `STRIPE_PRICE_YEAR_USD_STANDARD` | 9900 |

3. Configure a live **snapshot** webhook at the exact URL
   `https://api.jlpt.meritledger.org/api/v1/billing/webhooks/stripe`, using the
   pinned SDK API version above. Enable the events listed in
   `scripts/billing/check-live-readiness.ts` (Checkout completion/expiry/async
   outcome, PaymentIntent success/failure, refund lifecycle, and dispute
   lifecycle). Store this endpoint's signing secret, not a CLI listener secret.
   Runtime reads require Prices, Checkout Sessions, PaymentIntents, Charges,
   Refunds and Disputes access; creating Checkout requires write access. The
   one-off readiness script additionally reads the current Account and Webhook
   Endpoints; do not silently broaden a restricted runtime key merely for it.
4. Run the read-only checker in the protected deployment environment:

   ```sh
   node --env-file=.env --import tsx scripts/billing/check-live-readiness.ts
   ```

   It writes only booleans/version and performs no mutations. A successful
   result cannot prove that the configured signing secret matches Stripe or
   that delivery works. Confirm the registered endpoint delivery separately;
   use the existing sandbox for real payment-state/duplicate/refund tests.
   A fake locally signed event is not evidence of Stripe production delivery.
5. Reconcile the Checkout minimum-expiry boundary described below before
   charging. Finish the requested Gemini-first quality/fallback acceptance and
   paired API/Web checks. Then execute the one-time activation section of
   `w3-release-runbook.md`, keeping rewards false for Web. Confirm the owner's
   `LAUNCH_GIFT` under the billing lock; no fake order or administrator upgrade.

## Remaining checkout expiry boundary to verify

The locked contract promises a 30-minute quote. The current code persists
`now + 30 minutes`, retrieves the configured Price, and then passes that fixed
timestamp to Stripe. Stripe's documented minimum is **30 minutes after Checkout
Session creation**. A delayed first request or retry can therefore fall below
that minimum even though the local quote has not expired. Prior mock tests do
not emulate this Stripe constraint. The review does not silently change the
user's quote window or existing provider idempotency parameters.

Before activation, use the authorized sandbox and an isolated test order to
delay the Price retrieval by at least 2 seconds (also test a later retry), then
verify that the actual Session create accepts/rejects the expiry. Record only
the sanitized error code/parameter and timing. If rejected, implement a
versioned expiry policy with a sufficient provider creation buffer and a
bounded retry window, and update the quote contract consistently. Never change
`expires_at` across retries using the same existing Stripe idempotency key.

## Local acceptance

29 tests in four real isolated-Postgres suites passed: Checkout, Stripe
reconciliation, HTTP origin/raw-signature/account isolation and entitlement
boundaries. Includes four new stale-URL cases: expired status, paid status,
refunded status and a pending order whose deadline has elapsed. No production
database, Stripe API, browser session or credential was accessed by this agent.

```sh
npx jest --config test/sentence-lab/jest.json --runInBand \
  test/sentence-lab/checkout.acceptance-spec.ts \
  test/sentence-lab/stripe.acceptance-spec.ts \
  test/sentence-lab/http.acceptance-spec.ts \
  test/sentence-lab/entitlements.acceptance-spec.ts
```

Official references checked on 2026-09-13:
[Checkout creation and expiry](https://docs.stripe.com/api/checkout/sessions/create),
[webhook delivery, snapshot events and raw signatures](https://docs.stripe.com/webhooks),
[API keys](https://docs.stripe.com/keys),
[price fields](https://docs.stripe.com/api/prices/object).
