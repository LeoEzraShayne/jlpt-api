# Android full-screen verification — 2026-09-13

The user requested removal of the browser toolbar from the app's learning pages. A verified Trusted Web Activity is required; no browser origin-verification bypass is permitted.

## Production website

Production Web hotfix `22d3c17` is based on the already-live `05faa3ec` and adds only `public/.well-known/assetlinks.json`. It was deployed from the isolated `web-twa-verification` worktree, with the production API origin explicitly supplied. Cloudflare Worker version: `a8e1da0f-195f-4490-9420-92ad5b5a3f8f`.

Verified the public association returns HTTP 200, `application/json`, no redirect, and only the production package `com.meritledger.app` with the previously verified Play distribution and upload SHA-256 certificates. No debug certificate was added to the production site. Production API health remains OK.

The first worktree build failed because a symlinked node_modules caused Sharp native-module bundling errors. An independent npm ci resolved it; only the successful second build was deployed.

## Internal verification package

E prepared an APK-only `twaPreview` build using the production package, production Web origin and an empty native API setting. Native purchases/ads remain unavailable. E confirmed that the Pad did not already contain the production package; no legacy installation may be overwritten or removed to make this test pass.

The main agent read existing signing properties into memory, verified the existing upload certificate with keytool, signed the dedicated preview APK, and independently verified its signature with apksigner. Passwords were passed through process environment variables and were not printed or committed. The certificate matched the verified upload fingerprint ending `B3:52:AA:17`.

This authorizes only local installation of the signed full-screen verification APK for the user's requested UI fix. It does not open the release/AAB, Play submission, native payment, live ads, or legacy-purchase migration gates.

## Separate test environment

The debug package is associated only with the temporary HTTPS test origin through a separate proxy response. E reports verified App Links and disappearance of the browser toolbar on the Pad without disabling verification. The real AppModule test harness uses a newly created synthetic account/database and a one-use login URL kept in a mode-600 local file; it has no production secrets or external API access. This is not a real Google purchase or live ad acceptance claim.

Production-page Pad visual verification and the real test-account PKCE round trip are still in progress at this checkpoint.
