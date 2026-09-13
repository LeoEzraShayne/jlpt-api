# Web live billing readiness review

This is a source review and local acceptance record, not evidence that live
credentials, products, webhooks or charging have been activated. Android work
was paused under the owner's revised order of execution. The main agent alone
performs account, secret, production and activation operations.

## Verified implementation

- New quotes use USD 99 / 6400 / 9900 cents, one-time payment, card-only and
  Adaptive Pricing disabled. JP legacy inputs also quote USD; earlier order
  snapshots preserve their original currency and request parameters.
- The shared six-calendar-month period (UTC, month-end clamped) starts at the one immutable `BillingConfig.launchAt`.
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
4. Run the read-only **runtime subset** with the approved least-privilege key in
   the protected deployment environment:

   ```sh
   node --env-file=.env --import tsx scripts/billing/check-live-readiness.ts --runtime-only
   ```

   This mode reads only the three Prices with expanded Products and checks
   signing-secret presence locally. It never calls Account or Webhook Endpoints
   management APIs; the approved runtime key's `/v1/account` 403 is expected
   evidence of restricted permissions, not a reason to broaden the key.
   `runtimeChecksPassed: true` and exit 0 mean only this subset passed. Overall
   `passed` remains `null`; skipped checks remain `null` / `NOT_CHECKED` and are
   listed in `manualChecks`. Missing/wrong prices, missing secret, or API failure
   still fail. The script does not accept or synthesize manual attestations.

   The main agent must independently record the correct account and enabled
   card/charge/payout capability in the control panel, then the exact live
   endpoint URL, SDK-compatible API version and all 15 required event types.
   Main agent reported creating endpoint `we_1UF0OfKId1Bt4Wq3LVDDM0ww` with
   `2026-08-26.dahlia` and 15 events. That configuration observation is separate
   from actual signed delivery evidence, and is not a passing script check.
   The optional full configuration mode (omit `--runtime-only`) still requires
   Account/Webhook management read access and fails on missing permission; do
   not use it with the restricted runtime key or expand that key for this tool.

   Output contains no secrets and performs no mutations. A successful subset
   result cannot prove that the configured signing secret matches Stripe or
   that delivery works. Confirm actual registered-endpoint delivery separately;
   use the existing sandbox for real payment-state/duplicate/refund tests.
   A fake locally signed event is not evidence of Stripe production delivery.
5. Deploy and validate the versioned Checkout expiry policy described below
   before charging. Finish the requested Gemini-first quality/fallback acceptance and
   paired API/Web checks. Then execute the one-time activation section of
   `w3-release-runbook.md`, keeping rewards false for Web. Confirm the owner's
   `LAUNCH_GIFT` under the billing lock; no fake order or administrator upgrade.

## Checkout expiry boundary and versioned fix

Previously, the code persisted `now + 30 minutes` before Price retrieval and
Session creation. Stripe documents at least 30 minutes after Session creation.
The main agent's authorized sandbox experiment accepted a requested 1795-second
remaining lifetime (reported remaining 1794 seconds), but rejected 900 seconds
with HTTP 400 and the explicit 30-minute-minimum error. Thus small delay was
not proven to fail, while a long retry was proven to fail.

New quotes now persist `checkoutExpiryPolicy: CHECKOUT_60M_V1`, a fixed expiry
60 minutes after the quote and `checkoutCreationEndsAt` 25 minutes after the
quote. The creation deadline is checked both before and after Price retrieval;
the five-minute margin above Stripe's minimum covers bounded SDK network
retries and ordinary clock/network delays. Retries never recompute
`expires_at`, preserving Stripe idempotency. Whole-second quote timestamps
avoid an extra fractional-second truncation at the provider boundary.

A saved pending Checkout URL can be returned until its 60-minute expiry. An
uncreated quote at or beyond its 25-minute creation deadline returns
`CHECKOUT_EXPIRED` and needs a new request key. Historical quotes without this
policy keep their original request parameters and expiry; no order migration
occurs. A pre-cutoff launch-price quote retains USD64 through its own fixed
payment deadline; new quotes at or after the shared six-calendar-month cutoff use USD99.
The public contract's old blanket 30-minute statement must be updated to
describe this versioned behavior. Product durations and pricing are unchanged.

## Local acceptance

32 tests in four real isolated-Postgres suites passed: Checkout, Stripe
reconciliation, HTTP origin/raw-signature/account isolation and entitlement
boundaries. Includes four new stale-URL cases: expired status, paid status,
refunded status and a pending order whose deadline has elapsed. Additional
coverage verifies lost-response retry parameters, a 25-minute creation cutoff,
a fresh request after expiry, delayed Price retrieval, historical quote
parameters and the full 60-minute launch-price window. No production database,
Stripe API, browser session or credential was accessed by this agent; the
sandbox observations above were supplied by the main agent.

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
