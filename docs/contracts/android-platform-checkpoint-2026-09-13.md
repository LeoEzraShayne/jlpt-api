# Android platform checkpoint — 2026-09-13

## Completed and verified

Production Web remains the stable launch build plus the TWA Digital Asset Links hotfix (Worker `a8e1da0f-195f-4490-9420-92ad5b5a3f8f`). The Pad has the upload-certificate-signed, APK-only preview installed. Actual production learning content and the existing login render without the browser X, URL, share, or menu bar. Android status/navigation bars remain. Native API/payment/reward functionality is forcibly disabled in this preview.

Android source is committed through `46d1a38` in the local `jlpt-android` repository, which currently has no remote. Its validation report records 12 unit tests, four Pad instrumentation tests, strict lint/build, real isolated PKCE binding and session revocation. API unit checks pass 428 tests; independent integration checks pass 124 tests. API main includes the final SSV suffix fix and independent report. Web A1 changes are committed/pushed, but are not deployed to production.

All root-owned temporary QA processes (Web 3059, proxy 4402, Cloudflare Quick Tunnel) were stopped after E finished. F stopped both disposable AppModule harnesses and removed their databases/secrets. E restored the Pad's original wake, rotation, and 30-minute screen timeout settings and returned it to the production learning page.

## Google Play draft changes

In developer `8576711330364766433`, app `4972669113843626504` / `com.meritledger.app`, two new one-time products were saved as **draft**, each with purchase option `buy` and Chinese product text:

- `jlpt_day_pass`: USD 0.99 input to all-region automatic conversion.
- `jlpt_year_pass`: USD 99 input to automatic conversion. Google rounded the US result to USD 99.99; this was manually corrected to USD 99.00 and the UI confirmed the change was saved. Japan's generated standard-year price was JPY 15,200.

At the initial checkpoint no product was activated. After the user returned and reported saving the purchase option, a fresh Console read confirmed `jlpt_day_pass` / `buy` is now **active** (UI “有效”, with a deactivate button and saved confirmation), US USD 0.99 and Japan JPY 150. The year purchase option and `launch-64` offer still show **draft**. These later checks were read-only; existing lifetime products and subscriptions were untouched. Backend native commerce remains off, so active catalog configuration is not evidence of completed payment integration.

The `launch-64` offer was subsequently **saved and verified as draft**. It uses an absolute USD 35 discount with Google regional conversion, producing US USD 64.00 and Japan JPY 9,824 (JPY 5,376 discount from JPY 15,200). A temporary USD 64 discount was corrected before saving; no incorrect offer was activated. The Console labels the bulk discount input “new price”, but the resulting grid confirms it is the discount amount.

Draft offer starts `2026-09-13T01:15:00Z`, ends `2026-12-11T23:58:00Z`. Console rejects seconds and requires HH:mm UTC. The authoritative shared launch deadline remains `2026-12-11T23:58:15.676Z`. Resolve the 15.676-second discrepancy through the supported API before activation, or explicitly implement a matching purchase-availability boundary without changing the shared launch clock. The parent purchase option and offer remain disabled/draft.

Subsequent root-agent platform evidence on 2026-09-13: a one-field `offers:batchUpdate` request setting `discountedOffer.endTime` to `2026-12-11T23:58:15.676Z` returned actual Google HTTP **400**, message **“The offer end time is not aligned to the start of a minute.”** The [resource schema](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers) accepts RFC3339 timestamp syntax, but that does not establish business acceptance of sub-minute offer boundaries. No precision update succeeded; do not retry by extending the offer or moving the shared clock.

The implementation resolution is a native-only annual purchase pause: the Android catalog omits YEAR_PASS for `2026-12-11T23:58:00.000Z <= now < 2026-12-11T23:58:15.676Z`, while retaining DAY_PASS and the original launch timestamps. At the exclusive shared deadline, standard annual pricing becomes available. Android already refreshes the catalog before checkout and selects only the exact requested offer; a missing year product rejects a new purchase. This does not cancel a Google purchase sheet opened earlier, or reject a valid paid purchase/late provider notification. Web pricing, verification, consumption and entitlement handlers are unchanged. The isolated PostgreSQL regression suite is `test/sentence-lab/android-launch-gap.acceptance-spec.ts`; this implementation note is not evidence of deployment or offer activation.

## Direct publication authorization

The user subsequently explicitly instructed: “做好以后直接发布到谷歌市场”. Final Play submission and release are authorized after implementation and actual release checks succeed; do not request redundant final publication permission. This instruction does not claim the remaining platform checks are complete or answer the separately pending long-lived security-access confirmation. Record actual status separately as uploaded, in review, approved, and publicly available.

## Pending access and platform validation

The user explicitly confirmed creation of the backend service account, long-lived credential, secure JLPT backend storage, and this app's order query/management access. The account **was created**, its JSON key **was generated and safely saved**, and Play access is **active**, without expiration. Identity: `jlpt-play-billing-backend@diceroller-b89331d1.iam.gserviceaccount.com`, unique ID `109363111389121256230`. No project-wide Cloud IAM role was granted.

Play access is restricted to `com.meritledger.app`: financial-data read and order/subscription management, plus the Console-required app-information read permission and its implied app-quality read dependency. Trying app-quality read alone disabled the financial/order permissions, establishing that app-information read is required. No administrator, release, store-editing, policy, user-management, or account-wide permissions were selected.

The local JSON is `.local/google-play-backend-service-account.json` outside the repositories (mode 600). Server storage is `/var/www/jlpt-secrets/google-play-service-account.json` (directory 700, file 600, owned by the backend user). The identity and key format were checked without printing key contents. The protected live `.env` now points to this file and contains a new purchase-token encryption key; an existing encryption key is never overwritten. The previous `.env` was backed up with mode 600. PM2 reloaded/persisted successfully and its live process confirms the credential path, encryption-key presence, and all three native commercial flags false. API/database health remained OK at `2026-09-13T03:40:50.175Z`.

An initial request from the backend server received HTTP 200 from Google OAuth using this key, while the read-only voided-purchases call returned HTTP 403 `SERVICE_DISABLED` for `androidpublisher.googleapis.com`, project number `692705532429`. The user subsequently enabled the API directly and reported completion. The Cloud Console now visibly confirms **API Enabled**; there is no remaining Enable/terms confirmation request. Gemini project billing was not enabled.

After enablement, a fresh server-side OAuth exchange succeeded. At `2026-09-13T03:47:16.255Z`, `GET applications/com.meritledger.app/oneTimeProducts/jlpt_day_pass` returned **HTTP 200**, product `jlpt_day_pass`, purchase option `buy` state `ACTIVE`. This proves authenticated access to this app's catalog. At `2026-09-13T03:47:16.509Z`, `GET applications/com.meritledger.app/purchases/voidedpurchases?maxResults=1` still returned **HTTP 401**, reason `permissionDenied`, message “The current user has insufficient permissions to perform the requested operation.” The saved app-scoped financial-read and order-management permissions were independently re-opened and confirmed checked; no permission changes were made during this follow-up. Google documents app-scoped financial access as granting Purchases API access, so account-wide/admin permissions have not been added as a speculative workaround. Permission propagation is a possibility, not a verified cause. Catalog success is not proof of purchase verification, consumption, refunds, or RTDN completion.

The user then confirmed service-account authorization was complete. A later fresh server-side request at **`2026-09-13T03:55:01.288Z` returned HTTP 200 from voided-purchases**, with zero records. The earlier permission failure is resolved; no broader permissions or extra keys were added by the agent. This verifies read access to the refund/revocation listing, while a real purchase, Orders lookup, consumption and RTDN still require their own acceptance evidence.

API migration `202609130003_android_commerce` and the Android commerce code were subsequently deployed with all native entry/sales/ad gates closed. Live API is now **`87b89b7552f8c455a937334ba023372cc840498a`**, replacing `2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`. Web A1 is still not deployed. See [the guarded API deployment record](../production-android-api-2026-09-13.md). Keep native commercial flags off until real Play purchase/consume/refund/RTDN and AdMob test-ad/SSV validation is complete. No actual Play charge or ad reward has been verified.

## Existing app continuity

Read-only checks found the old Merit Ledger API health and Web entry reachable. Logged-in old member functionality was not verified. Preserve the old Web/API/data, old app version, four old SKUs, and existing subscription notification route. New JLPT verification does not restore those old products. Do not publish a same-package replacement before validating an accessible path to the old paid service and resolving any old-to-new benefit policy. No old lifetime purchase has been converted to unlimited JLPT AI.

Android commit `1b7d55b` subsequently added a native legacy-service/recovery entry. It reads only the three known `merit_ledger_prefs` draft keys and supported files under the old app-specific `recordings` directory, with local display/playback and user-selected document export. Raw JSON, unknown fields and original files are preserved; no deletion, automatic upload, old-token access or guessed draft/audio association was introduced. The legacy website opens at its fixed origin without passing draft/account data. E reports 21 passing unit tests (9 new synthetic recovery tests), debug build and strict lint, with Chinese/English/Japanese strings. Main read the recovery/activity implementation. No personal-device or real same-package upgrade test was performed in this step; those acceptance requirements remain open. Android repository has no remote and this commit is local only.

## 2026-09-13: isolated real platform callback acceptance

The following supersedes the earlier pending-callback status only for the stated
test scope. Production native commerce and advertising flags remain closed.

Main confirmed the owner's separate single-account license-testing list is saved;
the old 46-person closed-testing list was not selected. E confirmed the device's
Play account and installed an APK-only `playTest` variant using the existing app
package `com.meritledger.app`, test client `android-test`, and test callback path.
This does not authorize treating a normal payment instrument as a test card.
The JLPT backend uses synthetic non-gift accounts; the real Play account is
independent of those application accounts.

The isolated API runs on loopback 4401 with a fresh local PostgreSQL database.
Main's test proxy uses 4402, Web uses 3059, and authenticated RTDN test filtering
uses 4403. Public test origin is
`https://experiencing-reid-signs-postage.trycloudflare.com`. The protected platform
configuration references the existing service-account file; no credential
contents or copied production users were used as fixtures. SIGHUP configuration
reload was exercised with the same database, user and source-session identifiers
before and after. Runtime state, encryption key and test evidence are retained
privately on normal exit. See the [test process guide](../../test/sentence-lab/android-platform-harness.md).

### Real AdMob Verify URL callback

Main created the separate owned rewarded test unit
`ca-app-pub-6296584170791776/7191979288` under existing app
`ca-app-pub-6296584170791776~5699026455`, with reward amount 1 and item
`jlpt_task`. Native ad display stayed disabled; device-test confirmation was not
fabricated to enable it.

The first real Google verification-tool callback had a valid Google ECDSA
signature, matching ticket secret, user alias, reward item, amount and earning
window, but used Google's tool placeholder `ad_unit=1234567890`. The production
handler correctly rejected it against the real-unit ticket with HTTP 400 and
zero RewardEvents. With main's approval, only a newly issued isolated
Verify-URL-only ticket was explicitly bound to that observed placeholder. The
production verifier and ordinary real-unit ticket binding were unchanged.

The next real Google tool callback succeeded: one ticket became REDEEMED,
exactly one RewardEvent was created, and the synthetic reward balance changed
from 0 to 1. Three concurrent replays of that same signed callback each returned
HTTP 200, with one event and balance 1 retained. Safe evidence and an inspected
private PostgreSQL dump were saved before a controlled pre-purchase restart;
GooglePlayPurchase count was verified as zero before that restart. This proves
the real tool-to-backend signature, ticket and idempotent reward path. It does
not prove that watching an ad from the owned unit produces a valid callback.

### Real Play TestNotification through authenticated Pub/Sub

Main configured and activated test subscription
`projects/diceroller-b89331d1/subscriptions/jlpt-play-rtdn-test` with keyless push
identity `jlpt-play-rtdn-push@diceroller-b89331d1.iam.gserviceaccount.com`.
Its configured push audience is the public test origin followed by
`/api/v1/android/commerce/google/rtdn`. Main saved the Play notification topic,
selected one-time-product notifications, sent Play Console's actual test
notification, and then increased the subscription acknowledgement deadline from
10 to 30 seconds.

At **2026-09-13T04:28:40.634Z**, the test relay forwarded the real notification
and received HTTP 200 from the API. Both relay and API performed real Google
OIDC validation with the configured audience, verified push email, subscription
and package checks. The isolated database contained exactly one Google
BillingEvent with `eventType=TEST`, `status=PROCESSED`; GooglePlayPurchase remained
empty. One earlier relay failure counter was the deliberate unauthenticated
HTTP 401 smoke check, not a failure of the real notification.

Only RTDN traffic is routed through the test relay. After authentication it
filters old subscriptions/products and purchases Google identifies as live
before they can enter the test database. Real test-context purchases for the
two JLPT products are forwarded even when pending or without a known owner;
lookup failures return 503 for Pub/Sub retry instead of acknowledging an
unverified event. The original API still durably records and reconciles the
accepted purchase hints. Global voided-history scanning is disabled only in this
isolated process to avoid importing unrelated live orders. The relay has three
passing focused tests plus TypeScript/ESLint validation.

Remaining evidence: actual license-tester purchase UI, productsv2 and Orders
responses, consume, purchase/voided notifications and refund reconciliation,
plus a real owned-unit test-device ad view producing SSV. A successful
TestNotification alone establishes none of those purchase or refund outcomes.

## 2026-09-13 actual license-test day pass and refund follow-up

This section updates the remaining-evidence list above. The existing production
API native flags remained off. Main reported that the year product's `buy`
purchase option and `launch-64` offer were activated in Play Console; this is
configuration evidence, not a completed year-pass purchase. The following
actual order used the isolated database, an independent synthetic JLPT account
without a launch gift, and the owner's separately configured Play license-test
account. No production users were copied into the test database.

The device displayed Google's test-card approval flow and its explicit no-charge
notice, then reported payment success. Fresh productsv2 and Orders reads verified
`testPurchaseContext.fopType=TEST`, the bound opaque account ID, the day-pass
product, matching order/token evidence, and the actual JPY 150 total. The backend
recorded exactly one PAID order and one ACTIVE `GOOGLE_TEST` entitlement. Both
the durable queue and fresh Google evidence confirmed consumption. The grant
runs from **2026-09-13T04:31:25.710Z** to
**2026-09-14T04:31:25.710Z**, exactly 86,400 seconds. Device restore, process death
during restore, restart and another completed restore retained the same expiry;
the subsequent database check still found one order and one grant.

The first purchase RTDN retries exposed a test-relay initialization defect:
its standalone ConfigService omitted DATABASE_URL and BILLING_ENVIRONMENT.
GoogleGateway's real AndroidPolicy.assertIsolation therefore failed before the
Google purchase lookup. TestNotification had passed because its path did not
perform that lookup. Commit `73c2e96` supplies the validated private harness
state's loopback test database identity and explicit test billing environment,
and checks the real isolation policy at startup. Nine focused tests passed,
including rejection of production/non-test database names; TypeScript and
ESLint checks passed. Production gateway/policy logic was unchanged. Only the
relay restarted; API, sessions, purchase data and encryption key were retained.
Main changed Pub/Sub retry policy from immediate retries to exponential backoff
of 10–600 seconds, retaining the 30-second acknowledgement deadline.

The real queued purchase notification then reached the API at
**04:40:16.893Z**, returned HTTP 200, and became `PURCHASE_HINT / PROCESSED` at
**04:40:20.423Z**. The relay recorded no failures after the fix. Its pre-fix
safe error counters were retained separately rather than attributed to the new
process.

Main reviewed and executed a private refund driver limited to this pinned,
unrefunded test day-pass order. Before the refund request it re-read Google v2
and Orders evidence, checking test context, account/product/token/order linkage,
consumption, exact amount and the matching isolated database target. Google
accepted the full refund with revoke=true. The driver did not mutate the local
ledger or invoke reconciliation. The real `VOIDED_HINT` arrived at
**04:43:42.885Z** and became `PROCESSED` at **04:43:51.289Z** through normal
reconciliation. The unique queue became REFUNDED / NOT_APPLICABLE, the unique
order became REFUNDED with refundedAmount=150 JPY, and the unique grant became
REVOKED. No second grant was issued. Safe evidence is retained privately along
with the running isolated database; raw tokens, order identifiers, cookies and
signed callback URLs are excluded from this checkpoint.

After refund, the device completed two more `Check existing purchases` actions.
It displayed a free account after the first and remained free after the second.
A subsequent independent database read still found exactly one REFUNDED order,
one REFUNDED Google purchase and one REVOKED grant; restore did not issue a new
grant or start another purchase. This closes the real day-pass refund/recovery
check. The year-pass purchase and an owned-unit viewed-ad SSV remain separate
checks, and the production native flags remain disabled.

## 2026-09-13 owned-unit emulator test ad and real SSV

An Android 36 Google Play emulator independently reported the Google Mobile Ads
SDK's automatic `isTestDevice(context)=true`, with an empty explicit test-device
list and before any ad request. Main then authorized changing only the isolated
platform configuration to confirmed test device mode and disabling the Verify
URL tool-only mode. SIGHUP applied this to the existing API, database and
sessions; no production flag changed. The Pad build kept ads disabled.

The emulator generated a real native PKCE binding. Using the separate synthetic
reward account's existing valid Web cookie, the test operator approved that
exact request through the normal authenticated API, then delivered the returned
one-time HTTPS callback through the registered App Link. Native exchange
consumed the binding and matched the independent nonmember reward account.
There was no native token injection or synthetic replacement of the exchange.

The native reward flow created an ordinary ticket for owned unit
`ca-app-pub-6296584170791776/7191979288`. The emulator displayed Google's **Test
Ad** label, completed the ad sequence and displayed **Reward granted**; the
operator closed the ad without clicking its advertising content. Native then
reported one extra task. Independent backend verification of the actual captured
callback confirmed Google's ECDSA signature and the exact ticket, opaque alias,
unit `7191979288`, reward item `jlpt_task`, amount `1`, test environment and
reward timestamp window. The ordinary ticket became REDEEMED, exactly one
RewardEvent existed, and the synthetic reward balance changed from zero to one.
The older Verify URL placeholder ticket remained ISSUED, making the two evidence
paths distinguishable.

At **2026-09-13T04:50:32.699Z**, three concurrent replays of that actual signed
owned-unit callback each returned HTTP 200. The database still contained one
redeemed ordinary ticket, one reward event, balance one and reserved balance
zero. The actual callback is retained in a private mode-600 evidence file; only
safe projections are recorded here. This establishes the owned-unit SDK test-ad
view → real Google SSV → idempotent backend reward path in the isolated harness.
It does not establish production ad readiness or authorize enabling native
production flags.

### Year-pass availability diagnostic: still requires a successful device query

The device's Billing Library 9.1 query returned a successful overall result but
listed the year product under `UnfetchedProduct` with status **4**. Google's
[UnfetchedProduct.StatusCode reference](https://developer.android.com/reference/com/android/billingclient/api/UnfetchedProduct.StatusCode)
defines this as `NO_ELIGIBLE_OFFER`: the product was found but no eligible offer
was returned, including the case where no one-time purchase option is available.
It is a separate status namespace from BillingResult response codes.

At **2026-09-13T04:57:13.545Z**, authenticated read-only Developer API requests
showed `jlpt_year_pass / buy` ACTIVE with legacy compatibility, Japan AVAILABLE
at JPY 15,200, and the US AVAILABLE at USD 99. New-regions configuration was
AVAILABLE. Its `launch-64` offer was ACTIVE and within its configured
2026-09-13T01:15:00Z–2026-12-11T23:58:00Z time window; Japan was AVAILABLE with a
JPY 5,376 absolute discount (result JPY 9,824), and the US with a USD 35 discount
(result USD 64). No redemption limit or restricted-payment-country field was
returned. Both purchase option and offer contained 173 regional entries.
Google's [offer resource documentation](https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts.purchaseOptions.offers)
defines absoluteDiscount as the amount subtracted from the purchase option
price. These checks did not find a Japan configuration or active-time mismatch.
They do not prove the specific device/account is already eligible. Propagation
or account-specific availability remains an inference to test; no product state
was changed during this diagnosis, and no year-pass test order was placed.

### Attempted cancellation did not produce a passing cancellation test

A later device checkout exercise was intended to open the test-card sheet and
cancel with Back without purchasing. It must **not** be recorded as a passing
cancellation test: Google subsequently reported a distinct new day-pass test
purchase with completion time **2026-09-13T05:02:24.319Z**, matching the same
synthetic purchase account. Its token differed from the already refunded first
purchase. The operator reported no purchase-button action, but that report does
not override the provider's PURCHASED evidence; the exact UI trigger remains
unresolved. The device's subsequent already-owned message therefore was not
assumed to be a replay of the first refunded token.

The real purchase notification entered the durable queue, initially without an
owner, and normal reconciliation subsequently verified ownership, granted once
and consumed the test purchase. Main reviewed a separate private refund driver
pinned to this second completion time and its exact order/token fingerprints.
Fresh checks required test context, the synthetic owner, day-pass duration,
JPY 150 price, PAID/CONSUMED state and matching Google order evidence. Main
executed that test-only refund successfully; the script did not modify the
local ledger. By **2026-09-13T05:07:48.635Z**, the real voided notification had
automatically revoked the second grant. The two independent day-pass orders
were each REFUNDED for JPY 150, both grants were REVOKED, and two purchase hints
and two voided hints were PROCESSED. The first refund remained unchanged.
Cancellation and slow/pending-payment UI coverage remain incomplete at this
checkpoint; this additional test order is not evidence that either case passed.

## Permanent callback readiness and official app-ads.txt follow-up

Main reports the separate `meritledger-official` website repository deployed
commit `6b10981`: the official domain's root `/app-ads.txt` returns HTTP 200 and
matches the expected public Google seller line exactly. AdMob is now associated
with the existing same-package Play application. Its subsequent recheck has
**not passed** and displayed no useful detail; neither app-ads verification nor
production ad readiness is claimed. No production configuration or permissions
were modified as part of this read-only backend review.

The minimum remaining permanent callback configuration is:

| Item | Required value or action |
| --- | --- |
| Runtime isolation | Keep ANDROID_COMMERCE_ENVIRONMENT and BILLING_ENVIRONMENT both `live`; retain the current production database and stable live token-encryption key. |
| Play verification | Retain GOOGLE_PLAY_PACKAGE_NAME=`com.meritledger.app`, the already configured protected GOOGLE_PLAY_CREDENTIALS_FILE and GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY. No new backend service-account key is needed for Pub/Sub push. |
| Permanent RTDN route | Public HTTPS POST `/api/v1/android/commerce/google/rtdn` on the chosen permanent API origin; preserve the Authorization header and wrapped Pub/Sub JSON. Configure GOOGLE_RTDN_AUDIENCE to exactly match the configured push token audience, preferably that complete endpoint URL. |
| Permanent subscription | A distinct permanent subscription ID, never the temporary `jlpt-play-rtdn-test`; set GOOGLE_RTDN_SUBSCRIPTION to its full projects/.../subscriptions/... name. A suggested name is `jlpt-play-rtdn-live`, not an assertion that it exists. |
| Push identity | Set GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL to the selected dedicated keyless push service account. Scope Pub/Sub service-agent token creation permission to that identity; no Play financial/order permission is needed on the push identity. |
| Topic and delivery | Preserve the topic's Google Play publisher permission and the old products' service lifecycle. Use authenticated push, wrapped messages, acknowledgement deadline 30 seconds, retry backoff 10–600 seconds and no idle expiration for the permanent subscription. Monitor oldest unacked message age and rejected requests. |
| Permanent SSV route | Public HTTPS GET `/api/v1/android/commerce/admob/ssv`; preserve the original raw query encoding and exclude full signed URLs from access logs. Configure the owned ad unit's SSV callback to this permanent origin only when the test route is no longer needed for that unit. |
| AdMob runtime | ADMOB_REWARDED_AD_UNIT_ID must be the exact owned SDK unit ID; ADMOB_REWARD_ITEM=`jlpt_task`, with platform reward amount `1`. The server derives the numeric SSV ad_unit from the SDK unit and verifies Google's signature plus the issued ticket. No SSV shared secret is required. |
| Release gates | Keep ANDROID_COMMERCE_ENABLED, ANDROID_GOOGLE_ENABLED, ANDROID_ADMOB_ENABLED and database androidSalesEnabled/androidRewardsEnabled off until the unresolved checks are complete and main approves enablement. Web reward flags remain independent. |

Google documents the [Play topic publisher and RTDN setup](https://developer.android.com/google/play/billing/getting-ready)
and [authenticated Pub/Sub push identity/audience requirements](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).
The permanent subscription should join the selected app topic without replacing
or consuming another service's subscription. Topic delivery does not distinguish
license-test purchases from live ones using the present message envelope; a
Pub/Sub attribute filter cannot be assumed to provide that distinction.

One release blocker needs an explicit implementation decision before connecting
a mixed test/live stream permanently: the current production receiver durably
queues same-package tokens before fetching Google evidence. A token Google
identifies as test is correctly refused by a live worker, but its generic
reconciliation failure remains retryable. Choose and test either an authenticated
ingress classifier with durable/retry-safe Google validation, or a distinct
terminal ignored-test state after trusted v2 evidence. A test token must never
grant a live entitlement. Do not deploy the temporary test relay as a production
workaround, and do not infer safety from sales flags being false: RTDN/SSV receipt
and outstanding purchase/voided reconciliation intentionally continue with new
sales disabled, so existing purchasers retain lifecycle processing.

After permanent configuration, use an actual Play Console TestNotification to
prove authenticated route/audience/subscription handling, then inspect the
resulting processed event and real voided watermark health. A TestNotification
alone still does not prove a live purchase, refund or ad view. The hourly voided
sweep and 15-second durable-queue drain must remain operational with sales off;
alarm on growing retries, GOOGLE_VOIDED_HISTORY_GAP or stale watermarks.

### Later AdMob verification result and mixed-stream code follow-up

Main's second AdMob recheck succeeded: the UI explicitly confirmed verification
of the existing Android application. App-ads verification is now **VERIFIED**,
updating the earlier failed-recheck observation. AdMob then entered application
review; its UI stated review typically takes 2–3 days and ad serving remains
limited until review completes. This is **application review pending**, not
unrestricted production advertising readiness.

The mixed-stream code fix now introduces a terminal `IGNORED_TEST` queue state
only after the normal authenticated/package-checked ingress and trusted Google
v2 evidence identify a test purchase for a known JLPT SKU in the live environment.
It applies only before a local order exists. The fenced database transaction
records that evidence and marks associated events processed, creates no order or
entitlement, and never consumes the test purchase. Subsequent delivery replays
remain linked and processed without reopening the queue; the drain excludes
only this terminal state. Normal live/unknown-owner/provider-error processing
and the legacy-product boundary remain unchanged. Contradictory test evidence
for an already linked live order stays retryable instead of suppressing its
lifecycle. Native verify returns a specific HTTP 409
`GOOGLE_TEST_PURCHASE_NOT_SUPPORTED`; its successful response DTO is unchanged.

Eight independent PostgreSQL tests cover real RSA OIDC verification, bad
identity/package rejection, untrusted payload claims, trusted test finalization,
repeat delivery/drain behavior, stale fences, provider failure, old-product
boundaries and preservation of an existing live order. Together with existing
Google acceptance coverage, 27 tests passed; TypeScript and ESLint passed.
These are isolated automated tests, not production deployment evidence. Main
must review and deploy the code before treating this particular permanent
subscription blocker as closed; no production configuration was changed here.

### Explicit cancellation retest passed within its observed window

The later, separately controlled cancellation test had a fixed baseline at
**05:24:52.225Z**: two REFUNDED day-pass orders/queues, two REVOKED grants, and
processed notification counts TEST=1, PURCHASE_HINT=2, VOIDED_HINT=2. The device
opened checkout at **05:26:21.840Z**. Fresh screenshots and foreground checks at
05:26:26 and 05:27:06 showed Google's test-card/no-charge sheet. The operator
performed one Back action at **05:27:06.344Z**, without confirming purchase.
Native then displayed its USER_CANCELED message and a free account with no
reward balance. A fresh read-only restore completed at **05:29:14Z**, with its
button enabled and no waiting/new verification state.

At **05:29:33.497Z**, the independent database and RTDN counts still exactly
matched the baseline. Fresh Google v2/Orders reads of the two already-known
tokens continued to show CANCELLED/REFUNDED. These token lookups do not enumerate
all provider orders, and the native UI did not expose a raw owned-token count.
The combined explicit cancellation result, successful fresh restore and
unchanged backend evidence establish this cancellation path during the stated
observation window. They are not a claim of unrestricted provider-order
visibility or proof that no future notification can arrive. The earlier
unexplained test purchase remains recorded separately; slow/pending payment
coverage is still incomplete.

## Real slow-decline test and same-database repair

The later slow-decline test started from two refunded orders/two revoked grants.
Before checkout, the Pad's original native session had expired; the operator
completed a new normal PKCE flow through the actual Web approval button. The
backend verified the same synthetic user and source session. The new native
session expires at the unchanged source limit **2026-09-13T06:19:19.569Z**.

After selecting Google's explicitly labelled slow-declining, no-charge test
card, main approved a single confirmation at **05:34:21.378Z**. Native entered
waiting/free status; no separate Google pending screen was captured. During
that stage the existing two refunded orders and two revoked grants were
unchanged. Native does not submit a token to verification while Play still
reports it as owned and pending, so this is not a claim that the backend read a
pending productsv2 response. A subsequent real notification and fresh v2 query
established CANCELLED for the same test day-pass token and synthetic owner.

This exposed a real backend parser boundary. Google Orders returned HTTP 200
with `state=CANCELED`, order/token identity, createTime, lineItems and
orderHistory, but no total or lastEventTime; the v2 response had an order ID but
no completion time. The old worker required successful-order financial fields
before handling cancellation, causing retries and leaving native waiting.
Commit `9553c3c` handles trusted PENDING/CANCELLED attempts before that financial
lookup only when no successful local order or prior financial event exists.
It still validates environment, actual product/option/quantity and owner, and
uses a fenced transaction. CANCELLED also marks related billing events processed
and never grants or consumes. Existing financial records still require Orders,
including fallback to the stored verified order ID when v2 omits it; conflicting
purchase states cannot downgrade an existing successful order. Tests cover
Orders 404 and the observed missing-financial-field response, plus preservation
of prior financial state. All 28 Google PostgreSQL acceptance tests, TypeScript
and ESLint checks passed.

The fix was loaded into the isolated API by an explicit controlled restart,
retaining the same database, native sessions, purchase encryption key and expiry.
The original test harness had not persisted its random Web SESSION_SECRET.
With main's explicit approval, the test resume tool generated a mode-600 secret
and rebuilt only the tokenHash of the two pre-existing synthetic AuthSessions
from their original private cookies; IDs, users and expiry were unchanged, and
no user, session or billing record was bootstrapped. Both existing cookies then
returned HTTP 200 and the expected user through the external same-origin /me
route. The pre-restart database was privately archived and inspected; the new
entrypoint does not delete or migrate the database and does not extend expiry.
The resume tool is test-only and is not a production deployment entrypoint.

At **05:47:22.647Z**, the operator made one normal restore request for the same
recorded token. By **05:47:51.326Z**, its queue was CANCELLED /
NOT_APPLICABLE with no local order and no error, and its notification was
PROCESSED. The existing two refunded orders and two revoked grants remained
unchanged. The final fresh device screenshot at **05:50:56.478Z** showed
CommerceActivity, the cancellation message, a free account, zero extra tasks,
enabled restore/refresh buttons and no waiting text. No new checkout occurred.
A private post-fix database archive and safe projections are retained. This
completes the slow-decline/cancellation recovery check for this real test flow;
it does not claim a successful delayed-approval purchase or a year-pass purchase.

A follow-up guard in `0842334` also requires absent v2 purchaseCompletionTime for
the early unsettled path. Google's [productsv2 field reference](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.productsv2)
defines that field as the time a purchase successfully completed. A first-seen
CANCELLED snapshot that retains completion evidence therefore still reads Orders
and records a refund tombstone when appropriate. The added PostgreSQL regression
proves that such a refund creates no grant and is not misclassified as an unpaid
cancellation. The Google acceptance total is now 29 passing tests.
