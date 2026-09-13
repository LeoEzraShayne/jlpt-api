# Isolated year-pass license test (manual, no public backend)

This lane verifies exactly one `com.meritledger.app / jlpt_year_pass / buy / launch-64`
test purchase at JPY 9,824, its 365-day grant, consumption, replay and full refund.
It creates a fresh local PostgreSQL database and one synthetic `example.test` user.
It creates no AuthSession or native bearer, does not restore the expired earlier
harness, and never reads or changes the Pad's business account/session storage.
All native/commerce flags remain at their defaults. There is no HTTP listener,
tunnel, RTDN subscription change, SSV change, production deployment or scheduler.

E owns device instrumentation. The main agent reviews the frozen scripts, artifact,
exact offer and Google **test-card/no-charge** sheet before authorizing the single
purchase confirmation. These commands are not permission to buy or refund yet.

## Prepare and hand off

Run from the API repository root:

```sh
npx tsx test/sentence-lab/year-license-runner.ts prepare
```

This local-only command applies repository migrations to a new random
`jlpt_year_license_test_*` database. The only optional environment variable is
`TEST_DATABASE_ADMIN_URL`, restricted to a loopback `/postgres` database. It does
not load `.env`, connect to production or copy existing users. No database is
automatically deleted, including on a failed prepare. The output is the private
directory path; state, input and evidence files are created mode 600 in a mode 700
directory. `state.json` contains a new encryption key and the approved service
account **file path**, never a copied service-account credential.

`input.json` carries E's agreed manifest: schemaVersion, runId, expiresAt,
packageName, productId, purchaseOptionId, offerId, currency, priceAmountMicros,
obfuscatedAccountId. An additional createdAt gives the backend a bounded fresh
purchase interval. The account ID is the fresh synthetic user's persisted random
UUID; it is not the Google tester's email or a production JLPT identity. The
two-hour purchase window never extends an earlier session or run.

E reads input via a protected shell file descriptor, sets the exact offer and
obfuscated account ID, and exports only this attempt to mode-600 `output.json`:
schemaVersion, runId, purchaseState, productId, purchaseToken (only when present),
observedAt, and optional acknowledged/billingResponseCode. No token is sent through
stdout, logcat, argv, screenshots or normal app storage. PENDING/CANCELLED/FAILED
exports stop the backend tool without consuming or issuing an entitlement.

## Inspect, consume and refund (separate explicit operations)

Replace `PRIVATE_DIR` with the path returned by prepare; the placeholder is not an
environment assignment. Do not print state/input/output or pin files.

```sh
npx tsx test/sentence-lab/year-license-runner.ts inspect PRIVATE_DIR
npx tsx test/sentence-lab/year-license-runner.ts verify-consume-approved-test PRIVATE_DIR
npx tsx test/sentence-lab/year-license-runner.ts prepare-refund PRIVATE_DIR
# Main reviews the fresh exact-target refund plan before this command:
npx tsx test/sentence-lab/year-license-runner.ts execute-approved-test-refund PRIVATE_DIR
# After Google reports REFUNDED; this is a direct reconciliation, not an RTDN test:
npx tsx test/sentence-lab/year-license-runner.ts reconcile-refund PRIVATE_DIR
```

`inspect` performs only Google reads and writes a local immutable target pin. It
requires authoritative v2 `testPurchaseContext.fopType=TEST`, exact synthetic owner,
SKU/option/offer/quantity=1, JP, JPY 9,824, fresh purchase completion, and matching
Orders token/order/product. Client metadata alone satisfies none of these checks.
The first successful inspection pins token hash, Google order ID and completion;
later invocations cannot switch to another otherwise valid test order.

The consume command uses the actual `GooglePurchaseService` with a gateway limited
to the pinned test token/order. Fresh authoritative guards run again before consume.
It verifies one PAID order, one ACTIVE grant, exactly 31,536,000 seconds from Google
completion, fresh provider consumption, and no extension after another enqueue and
reconcile. No generic token enumeration or unrelated provider order is queried.

Refund preparation additionally requires the one local order to be paid, unrefunded,
consumed, with one active year grant, plus fresh Google test/consumption evidence.
Execution requires the same pin and a plan under one hour old. An exclusive
`refund-attempt.json` is written before the refund POST, so an uncertain HTTP result
cannot be blindly repeated. Inspect the same order's Google state before any
recovery decision; do not delete the intent to force a retry. The refund command
does not change the ledger. The final command requires fresh Google REFUNDED
evidence, then invokes the actual service twice and checks one REFUNDED order,
one REVOKED grant, full JPY 9,824 reversal and no second consumption.

Existing permanent RTDN may receive this test order; the production trusted-test
classifier is expected to ignore it without granting live access. This lane does
not independently prove annual RTDN delivery. The earlier actual day-pass RTDN
purchase/refund path remains separate evidence. Preserve the database and private
files for final inspection/export; no long-lived test service needs stopping.
