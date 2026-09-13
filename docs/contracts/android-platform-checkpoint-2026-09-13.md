# Android platform checkpoint — 2026-09-13

## Completed and verified

Production Web remains the stable launch build plus the TWA Digital Asset Links hotfix (Worker `a8e1da0f-195f-4490-9420-92ad5b5a3f8f`). The Pad has the upload-certificate-signed, APK-only preview installed. Actual production learning content and the existing login render without the browser X, URL, share, or menu bar. Android status/navigation bars remain. Native API/payment/reward functionality is forcibly disabled in this preview.

Android source is committed through `46d1a38` in the local `jlpt-android` repository, which currently has no remote. Its validation report records 12 unit tests, four Pad instrumentation tests, strict lint/build, real isolated PKCE binding and session revocation. API unit checks pass 428 tests; independent integration checks pass 124 tests. API main includes the final SSV suffix fix and independent report. Web A1 changes are committed/pushed, but are not deployed to production.

All root-owned temporary QA processes (Web 3059, proxy 4402, Cloudflare Quick Tunnel) were stopped after E finished. F stopped both disposable AppModule harnesses and removed their databases/secrets. E restored the Pad's original wake, rotation, and 30-minute screen timeout settings and returned it to the production learning page.

## Google Play draft changes

In developer `8576711330364766433`, app `4972669113843626504` / `com.meritledger.app`, two new one-time products were saved as **draft**, each with purchase option `buy` and Chinese product text:

- `jlpt_day_pass`: USD 0.99 input to all-region automatic conversion.
- `jlpt_year_pass`: USD 99 input to automatic conversion. Google rounded the US result to USD 99.99; this was manually corrected to USD 99.00 and the UI confirmed the change was saved. Japan's generated standard-year price was JPY 15,200.

No product was activated. Existing lifetime products and subscriptions were untouched. The day pass's precise Japan price still needs a read-back.

The `launch-64` offer is only an **unsaved browser form**, not a created offer. Its type is absolute discount. Start date was selected as September 13, but the UI time defaults to 17:00 UTC and must be corrected before saving. Discount values and end date are not configured. US discount must produce exactly USD 64.00 from USD 99.00; regional prices need review after conversion. The shared launch deadline remains `2026-12-11T23:58:15.676Z`; do not reset the launch clock or silently extend it. This form is retained for continuation.

## Pending access and platform validation

The Cloud Console service-account form for `JLPT Play Billing Backend` / `jlpt-play-billing-backend` in `diceroller-b89331d1` is prepared but **not submitted**. A user confirmation is pending for creating the account and long-lived credential, storing it in the JLPT backend, and granting only the specific app's financial/order read and order/subscription management permissions. Browser security-access rules require this action-time confirmation. No IAM account, key, or permission was created, and Gemini free-tier project billing was not enabled.

API migration `202609130003_android_commerce`, Android commerce code, and Web A1 are not yet deployed. Live API remains `2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`. Keep native commercial flags off until real Play purchase/consume/refund/RTDN and AdMob test-ad/SSV validation is complete. No actual Play charge or ad reward has been verified.

## Existing app continuity

Read-only checks found the old Merit Ledger API health and Web entry reachable. Logged-in old member functionality was not verified. Preserve the old Web/API/data, old app version, four old SKUs, and existing subscription notification route. New JLPT verification does not restore those old products. Do not publish a same-package replacement before validating an accessible path to the old paid service and resolving any old-to-new benefit policy. No old lifetime purchase has been converted to unlimited JLPT AI.
