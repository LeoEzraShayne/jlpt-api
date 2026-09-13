# Isolated Android platform process

This is a local test entrypoint, never a production deployment. It extends the
disposable AppModule device harness with real Google provider requests. It binds
only `127.0.0.1`, creates a random local PostgreSQL database, applies repository
migrations, and uses two synthetic `example.test` users. No production data or
repository `.env` is read. Normal termination now retains the test database,
private session/ticket artifacts and its mode-0600 test encryption key for
reconciliation and evidence; `--discard-on-exit` explicitly opts into cleanup.
Startup requires an empty state directory and cannot overwrite retained state.
A new process with a new state directory creates new users and bindings; do not
restart in the middle of a Play purchase.

Run from this worktree with its own dependencies:

```sh
npx ts-node --files test/sentence-lab/android-platform-harness.ts \
  --port 4401 \
  --frontend-url https://YOUR-APPROVED-TEST-ORIGIN \
  --api-public-url https://YOUR-APPROVED-TEST-ORIGIN \
  --platform-config /PRIVATE/platform.json \
  --state-dir /PRIVATE/state \
  --max-minutes 120
```

The process does not create a tunnel. The owner may separately proxy API 4401 and
Web 3059 through proxy 4402 after selecting an approved test origin. Local-only
preparation can use `http://localhost:3059` for both URL arguments.

`platform.json` must be an absolute regular file owned by the process user with
mode 0600 (no symlink). The owner injects only these supported configuration keys:

```json
{
  "googleCredentialsFile": "/PRIVATE/existing-google-service-account.json",
  "admobAdUnitId": "ca-app-pub-YOUR_PUBLISHER/YOUR_TEST_UNIT",
  "admobRewardItem": "jlpt_task",
  "admobSsvVerifierOnly": true,
  "admobTestDeviceConfirmed": false
}
```

Optional RTDN fields: `rtdnAudience`, `rtdnSubscription`,
`rtdnServiceAccountEmail`. These do not create a Pub/Sub subscription or change
its routing. Never replace the legacy app's notification route for this test.
The test token encryption key is random and stored only in the protected state
directory; no production key is needed. Once running, SIGHUP reloads the private
platform config and updates RTDN values, ad unit/item and the explicit ad testing
mode without changing database, users, sessions or token encryption key. Changing
service-account identity/path through this reload is rejected. The safe flags
and reload timestamp appear in state.json; configuration values are not logged.

Google uses package `com.meritledger.app`, client `android-test`, callback
`/android/callback/test`, and ledger environment `test`. A real license tester
must see a test payment instrument in Play's purchase dialog. A `.debug` package
cannot test the existing app's Play products. Google must return
`testPurchaseContext`; a live purchase cannot grant or consume here. Actual
Orders money is required; missing order evidence remains pending, never replaced
with a hardcoded price. The API's normal test-token reconciliation runs. The
global voided-history timer is explicitly disabled because its account-wide
result could import unrelated live purchases; this process is not evidence of
voided-sync acceptance.

Inherited environment is cleared, HTTP/HTTPS clients are disabled, and fetch is
restricted to Google OAuth, Play APIs for this exact package, OIDC public keys,
and AdMob verifier keys. Redirects are refused. AI and Stripe are unconfigured.

The protected `state/state.json` contains two one-use synthetic login URLs and
their cookie file paths. The purchase user and reward user are separate so a
successful purchase does not make the reward tester ineligible. Neither has the
owner's gift email. The real Play license-test Google account is independent
from the synthetic JLPT account; the native purchase must still attach the
server-returned opaque account ID. Do not print cookies, binding codes or tokens.

With `admobSsvVerifierOnly:true`, native advertisement entry stays disabled.
The harness privately issues a real 20-minute ticket to the reward user and
writes `state/ssv-ticket.json` with `customData`, `ssvUserId` and callback URL for
AdMob's Verify URL tool. Sending SIGUSR2 to the PID in `state.json` mints a fresh
ticket without restarting or issuing a reward. Only the unchanged real SSV
handler can verify Google's signature and credit the test account. Tool
verification is not proof that watching a test ad caused the callback.

Actual Google Verify URL callbacks were observed using placeholder
`ad_unit=1234567890`, even when verifying the new owned unit. The isolated
tool-ticket issuer therefore sets only its newly issued ticket's `ssvAdUnitId`
to that placeholder and labels the private artifact with `expectedToolAdUnit`.
The first genuine callback against a normal owned-unit ticket was correctly
rejected with no reward: signature, alias, item and time window matched, but
the ad unit did not. Production verification and tickets for SDK impressions
retain exact real-unit matching. A successful tool callback cannot establish
that the real owned unit supplies its correct numeric ad unit.

Only after the Android test-device setup is independently confirmed may the
owner choose `admobSsvVerifierOnly:false` and `admobTestDeviceConfirmed:true` for
the self-owned unit. The harness cannot verify device registration itself.
An empty config uses the shared Google demo ad unit for SDK display checks only;
it cannot establish the callback configuration of an owned unit.

For a test subscription receiving all app events, run
`android-test-rtdn-relay.ts` with the same `--platform-config` and `--state-dir`
arguments on port 4403. Route only `/api/v1/android/commerce/google/rtdn` from
the test proxy to this relay; all other API traffic remains on 4401. The relay
verifies Google OIDC plus the exact configured subscription and package before
filtering legacy subscriptions/products. It fetches Google's v2 evidence for
new one-time and voided hints; only real test context for the two JLPT products
is forwarded unchanged to the real API. It never requires an owner or order to
exist, so pending and unknown-owner test purchases retain the normal durable
queue path. Provider lookup failures return 503 for Pub/Sub retry, never a
successful filtered acknowledgement. Known live or irrelevant product events
are acknowledged only on this separate test subscription without database writes.
This adapter must never replace the production/legacy RTDN subscription.

Relay PID and safe counters are in `rtdn-relay.json` and
`rtdn-relay-stats.json`; SIGHUP reloads its platform config. Set a push acknowledgement
deadline that accommodates cold Google identity and purchase queries. Stop the
relay separately with SIGTERM when testing finishes; stopping it does not modify
the API database.

References: [Play license testing](https://developer.android.com/google/play/billing/test),
[AdMob SSV](https://developers.google.com/admob/android/ssv),
[AdMob callback testing](https://support.google.com/admob/answer/9603226?hl=en).
