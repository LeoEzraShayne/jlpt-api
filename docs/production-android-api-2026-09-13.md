# Android API deployment — 2026-09-13

API release `87b89b7552f8c455a937334ba023372cc840498a` is deployed behind closed Android gates. Production Web remains Worker `a8e1da0f-195f-4490-9420-92ad5b5a3f8f`; no Web build or Cloudflare deployment was performed in this step.

## Backup and migration

The pre-deployment PostgreSQL custom backup is `/var/www/jlpt-backups/android-api-87b89b7552f8c455a937334ba023372cc840498a.dump`, SHA-256 `aac26b8af1dc441cd334551a54c14d14c8e908f3c4b2deacbd8fb75d6c1f69ff`. Its archive inventory was readable. Evidence and backup files are protected by mode 600.

The release has independently installed dependencies, a newly generated Prisma client and a successful Nest build. Migration status confirmed the sole pending migration was `202609130003_android_commerce`; it applied successfully before the API symlink switch, and all 18 migrations are now current. No reset, down migration, activation, gift creation or content import was run.

The before/after comparison preserved all 20,619 pre-existing IDs in tables with an `id` column. Existing BillingConfig fields were unchanged; the five new tables were empty before the new process started, new Android database flags were false and all new user Google account IDs were null. The initial grant snapshot selected source `GIFT` and matched no rows, so that check alone did not prove launch-gift preservation. A separate check parsed the real `LAUNCH_GIFT` row directly from the protected pre-deployment backup and compared its identity, source key, duration, start and end with the live database: one grant, unchanged. No grant data or credentials were printed.

## Runtime and verification

`/var/www/jlpt-api` points to the new release. Existing PM2 process `jlpt-api` reloaded and persisted successfully; its status is online. The prior release and its independent dependencies/configuration remain available.

Protected runtime configuration explicitly sets `ANDROID_COMMERCE_ENVIRONMENT=live`, matching the existing live billing environment. `ANDROID_COMMERCE_ENABLED`, `ANDROID_GOOGLE_ENABLED` and `ANDROID_ADMOB_ENABLED` remain false. The Google credential path and token encryption key are retained. Google reconciliation jobs are gated by credential availability rather than new-sales flags; closed sales gates do not imply disabled refund reconciliation. RTDN and AdMob configuration and real platform acceptance remain outstanding.

Actual checks after the switch:

- At `2026-09-13T03:54:02.271Z`, public health returned HTTP 200 with API and database OK.
- Global and Japan Web catalogs returned HTTP 200, USD 0.99 day / USD 64 launch year, sales enabled. Shared launch `2026-09-12T23:58:15.676Z` and deadline `2026-12-11T23:58:15.676Z` were unchanged.
- Native commerce catalog returned HTTP 503 `ANDROID_COMMERCE_DISABLED`, as intended.
- The actual Chrome session loaded the authenticated production today page, membership page and populated learning history. Membership displayed expiry `2027/9/13 08:58:15` JST and unchanged prices.
- Google service-account OAuth and catalog access returned HTTP 200. After initially returning permission errors, the actual voided-purchases endpoint returned HTTP 200 with zero records at `2026-09-13T03:55:01.288Z`. This is not proof of purchase/consume/RTDN or advertising completion.

## Recovery and remaining work

For a code rollback, retain new tables and data, restore the API symlink to `/var/www/jlpt-releases/2a9ed47ca6c96ef8d5c3579d7fcec21317d6a1e4`, and reload the existing process using that release's protected environment. Do not restore the backup over newer customer activity or remove the purchase-token encryption key. The additive schema remains compatible with the old Web API.

Android real test-purchase/consume/refund/RTDN, AdMob test-ad/SSV, final Web/native configuration, legacy upgrade continuity and Play release checks remain required. Test purchases must use an isolated test database. No store release was submitted and native sales/ads were not enabled by this deployment.
