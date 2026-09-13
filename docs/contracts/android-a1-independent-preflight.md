# F Android A1 independent preflight

Source: main `97a1498`, frozen `android-commerce-v1.md`. F test commit: `e7f6a16`. Scope is migration/contract compatibility before A's endpoint implementation, not Android purchase/ad/device acceptance.

## Verified locally

**75 tests in 14 independent acceptance suites passed** against disposable real PostgreSQL databases (the existing 70 Web tests plus five Android storage/compatibility tests). TypeScript and scoped ESLint passed. No platform, production, device or provider operation was performed.

The migration test creates a random local database through migration `202609130002`, inserts synthetic existing Web account/session, live-paid legacy JPY order, fixed launch gift/config and Stripe event, snapshots every pre-existing public table, and applies the exact `202609130003_android_commerce/migration.sql`. All old rows/columns are unchanged after excluding the four intentionally added fields; exactly five tables are added. Android sales/reward flags default false while existing Web sales/enforcement and immutable timestamps stay intact. Calling the actual guarded Web activation afterwards preserves the existing gift/time and leaves both native flags off.

The storage tests also verify an ownerless/productless token queue can be persisted without creating a payment or grant; the same package/token cannot be duplicated under another environment; two events can reference the same queue; multiple tickets coexist with request-key uniqueness and ticket insertion alone grants no reward. Environment validation accepts existing production Web configuration without requiring currently disabled Android platform credentials.

Initial fixture-construction failures were corrected before the passing run: raw SQL needed the pre-existing EntitlementGrant.updatedAt field, and pg serializes JavaScript Date values in host time unless the fixture supplies explicit UTC strings for TIMESTAMP columns. These were test-fixture errors, not migration damage; no production timestamp was edited.

## Contract/schema observations requiring implementation evidence

No destructive DDL or schema-only blocker was found. The proposal's mandatory nullable ownership, token uniqueness, many-event queue link, fenced lease/revision and separate default-false rollout flags are present.

- `sourceSessionId` and `googlePurchaseId` are scalar columns/indexes, not physical foreign keys. The frozen contract can use explicit guard/transaction checks, but A must prove source existence/ownership/expiry on every request and atomic event-to-queue persistence. No FK/cascade guarantee is claimed from this migration.
- AndroidCommerceSyncState has a watermark and lease but no persisted page token or fixed interval endpoints. A can safely restart the entire overlapping interval from its durable watermark on failure, with a captured fixed interval end and fenced advancement only after all pages succeed. It must not claim mid-page resume or advance after a partial scan. If A needs resumable paging instead, main must add the corresponding durable fields.
- The environment schema alone does not prove production test-commerce isolation, credential validity, OIDC, PKCE or SSV checks. Those belong to actual enabled-route/service guards and remain unverified until A's candidate exists.

## Independent A1 tests to add when implementation is available

No missing endpoint has been mocked into success or marked passed. The next bounded acceptance batches will invoke the actual services/routes:

1. Binding: wrong verifier/client/state, repeated approval/exchange, source expiry/logout/account switch, independent device preservation and scopes; no bearer/secret in redirects.
2. Google: pending and unknown owner, RTDN before client verify, transactional token durability, environment mismatch, exact product/offer and opaque account matching, new event during a leased fetch, late stale writer, crash before/after consume, refund-before-grant and monotonic refund state.
3. Rewards: signed-byte vectors including encoded values/duplicates, earned-time millisecond bounds and delayed callback, numeric/full unit mapping, wrong aliases/secrets/amount/item, duplicate transaction/ticket, response loss/new key, membership acquired after earning and test/live isolation.
4. Runtime shutoff: disabled new purchases/tickets with already-earned reward and existing cancellation/refund reconciliation preserved; Web launch state and existing member access remain unchanged.

Real Google Play signature/account/purchase UI and real AdMob SSV/device acceptance remain main/E/platform work. This preflight only establishes a compatible starting point for implementation.
