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
