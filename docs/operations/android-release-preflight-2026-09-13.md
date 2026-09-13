# Android production preflight, 2026-09-13 07:24–07:29 UTC

Read-only inspection of the deployed API found a voided-purchase bootstrap bug.
This report and its accompanying fix do not enable native commerce, deploy code,
run a production sweep, consume purchases, issue refunds, or publish to Play.

## Runtime configuration checked

- Deployed release remains `86b3ee513c354d079b741577d54994b6134f3dbd`, PM2 `jlpt-api` ID 30 online, with the expected working directory.
- Effective Android and billing environments are both `live`; production database identity is correct. The service-account file has mode 600 and the required credential shape; the stable token-encryption key has the required 32-byte hex shape. Secret values were not printed.
- API origin: `https://api.jlpt.meritledger.org/api/v1`; frontend origin: `https://jlpt.meritledger.org`. Fixed release callback: `/android/callback`; release client: `android-release`; package: `com.meritledger.app`. Client selection comes from the live/test policy, not a separately configurable client allowlist.
- RTDN audience exactly matches `https://api.jlpt.meritledger.org/api/v1/android/commerce/google/rtdn`; subscription is `projects/diceroller-b89331d1/subscriptions/jlpt-play-rtdn-live`; push identity is configured.
- AdMob owned unit is `ca-app-pub-6296584170791776/7191979288`, reward item `jlpt_task`. The permanent SSV URL is the same API origin plus `/android/commerce/admob/ssv`.
- Runtime `ANDROID_COMMERCE_ENABLED`, `ANDROID_GOOGLE_ENABLED`, `ANDROID_ADMOB_ENABLED` and DB `androidSalesEnabled`, `androidRewardsEnabled` are all false. Web sales/enforcement are true; Web rewards remain false. Original launchAt remains `2026-09-12T23:58:15.676Z`.
- `AI_PRIMARY_PROVIDER=DEEPSEEK`, but `GEMINI_FREE_FIRST=true` remains effective. The pending user routing/region decision is still required; primary-provider selection alone does not resolve it.

Public checks: native catalog returns 503 while disabled. The release callback returns HTTP 200 with no-store, no-referrer, restrictive CSP and HSTS. Public assetlinks contains only the production package and the two previously recorded production fingerprints (Play signing and upload); no debug package was present. This does not substitute for checking the actual final artifact against Play signing configuration and device App Links.

## Fresh Google product reads

Both one-time products and `buy` options remain ACTIVE, each with 173/173 configured regions AVAILABLE. Day: US USD 0.99, JP JPY 150. Annual standard: US USD 99, JP JPY 15,200. Both options' new-region configuration is AVAILABLE.

`launch-64` remains ACTIVE with 173/173 configured regions AVAILABLE, start `2026-09-13T01:15:00Z`, end `2027-03-12T23:58:00Z`. Absolute discounts are USD 35 / JPY 5,376, giving USD 64 / JPY 9,824. The offer has no new-region configuration field; no future-region offer inheritance is claimed.

## Voided sync blocker and fix

At 07:25:13Z, the production `google-voided:com.meritledger.app:live` sync row had null watermark and last-success timestamps, and `GOOGLE_VOIDED_SYNC_FAILED`. An independent read using the deployed gateway with an exact local 30-day interval reproduced HTTP 400 `badRequest`: `Start time [...] must be within [30] days of data.` An otherwise equivalent 719-hour interval succeeded. A request omitting startTime also succeeded. This establishes a request-boundary bug, not missing financial permission.

The bootstrap computed local now minus exactly 30 days. By Google's receipt time, that timestamp is outside retention. The [official API contract](https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.voidedpurchases/list) says omitted startTime defaults to Google's current time minus 30 days; pagination tokens supersede time filters.

The patch omits startTime for bootstrap and when the desired overlap reaches the retention boundary. Ordinary incremental scans retain their explicit one-day overlap. An existing watermark older than 30 days still fails with `GOOGLE_VOIDED_HISTORY_GAP`; failure still cannot advance the watermark. There is no arbitrary margin that silently discards bootstrap history.

Validation: 3 gateway unit tests, 23 isolated PostgreSQL acceptance tests across the two Google suites, build, changed-file lint and 256-file line check passed. Tests include request encoding, bootstrap, overlap at retention, ordinary overlap, stale leases, failed later pages, and history gaps. Production sync remains unverified until the reviewed fix is deployed and an actual scheduled or separately authorized sweep completes successfully.

## Minimum activation sequence

1. Review and deploy the boundary fix through the existing guarded release procedure without migrations or secret rotation. Verify successful production voided watermark/lastSuccess, no sync error, and healthy durable-queue handling. Do not reset a failed watermark manually.
2. Finish the bounded annual TEST purchase/consume/refund acceptance in its isolated database; complete final release artifact, identity, upgrade, R8/manifest/16KB, UMP and native account-binding checks. Keep production TEST transactions from granting live benefits.
3. For production binding verification, enable only the runtime native entry gate after the final client is approved; keep Google/ad runtime and DB sales/reward gates false while verifying the actual release client, fixed callback, catalog, account and entitlements.
4. Enable Google sales only after these checks by setting runtime `ANDROID_GOOGLE_ENABLED` and DB `androidSalesEnabled` together with the native entry gate. Preserve original launchAt, Web switches, saved quotes/orders and product identities. Verify localized offer selection and no standard-price fallback while the launch offer applies.
5. Enable ads independently only after final consent/eligibility/owned-unit readiness: runtime `ANDROID_ADMOB_ENABLED` plus DB `androidRewardsEnabled`. Verify permanent signed SSV, one-task reward and replay protection; URL verification alone is not ad-view evidence. Keep Web rewards false.
6. Resolve AI regional routing and reviewer login, finish Data Safety/store declarations and final Play checks before authorized submission. No submission or rollout is established by this preflight.
