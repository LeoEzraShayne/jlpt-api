# Android identity preflight — 2026-09-13

Read-only preparation while W2 AI quality and pricing gates remain open. No Android release, product change, signing-key change or account permission change has been made.

## Verified identity

- Existing Play application: 功过格, package `com.meritledger.app`, application ID `4972669113843626504` under developer `8576711330364766433`.
- The complete app-bundle selector lists 22 uploads, descending from **version code 22 / version name 1.0.1**, uploaded August 8, 2026. A future update must exceed 22; verify again immediately before upload.
- The preserved original Android project's Gradle configuration also uses version code 22 / version name 1.0.1, minimum SDK 24 and target SDK 36. Original project: `/Users/shen/Downloads/merit-ledger/merit-ledger-android`.
- Play upload certificate SHA-256: `99:E7:FB:68:5B:2D:A0:6A:44:6F:E3:77:69:1D:64:96:5F:71:74:D4:9F:30:01:EB:FD:B0:CC:8B:B3:52:AA:17`. `keytool -printcert -jarfile` on the preserved `app/release/app-release.aab` reports the same public certificate fingerprint. No keystore password was read or printed for this check.
- Play's Digital Asset Links example identifies the **distribution signing certificate** as `AC:D9:FE:6F:7A:58:41:ED:11:D3:2A:D6:66:83:59:3D:17:6F:39:77:C6:AA:1D:98:2B:99:5E:B9:2F:40:41:9D`. This differs from the upload certificate. Use the actual installed distribution certificate for production site association, and independently verify the downloaded/installed release during A2.
- Play reports automatic protection active and Google Play App Signing in use. No protection or key settings were changed.

## Legacy entitlements require reconciliation

The old application contains two one-time lifetime products with active purchase options: `ml_premium_lifetime` and `ml_pro_lifetime`. It also contains subscriptions `ml_premium` and `ml_pro`, each with two active base plans. Product existence does not establish that anyone bought them. The monetization overview reports JPY 0 revenue for the last 28 days; that short period alone does not establish zero historical purchases.

The developer-level order management page, with an empty search field and date range **January 1, 2008 through September 12, 2026**, returned “没有相符的订单” after loading. This is evidence that the current console search contains no orders, not a license to delete legacy records or assume other payment systems have no purchases. No refund, cancellation, product edit or key reset was performed.

The app list shows 16 installed users, which is not a paid-user count. Preserve all products and old records. Confirm legacy backend records, subscription handling, AdMob configuration and real-device upgrade behavior during A0/A2 before publishing the replacement.
