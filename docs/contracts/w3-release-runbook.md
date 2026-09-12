# W3 release runbook (prepared, not executed)

The production application remains on the pre-Sentence-Lab release. Follow `w2-validation.md` for completed rehearsals and open quality/pricing gates. This document does not authorize bypassing those gates.

## Freeze the release candidate

Record matching API/Web commit hashes, passing CI and F's independent acceptance of the actual provider route (including repair). Recompute costs using that route's complete receipts. Record the owner's answer to the annual-pricing conflict and implement any resulting product-availability change before live configuration. Do not add an undisclosed learning cap.

Verify the target again: API host `api.jlpt.meritledger.org`, database `jlpt`, PM2 process `jlpt-api`, port 4500; Web Worker `jlpt-web`, Cloudflare account `9d2a9911ed118bef4f747712e92c4426`. Resolve and record `/var/www/jlpt-api` before modifying its symlink. Do not confuse the local port-4502 sandbox or the server's isolated restore database with production.

## Prepare and migrate with sales off

1. Take a fresh PostgreSQL custom-format backup into the protected `/var/www/jlpt-backups` directory. Record SHA-256 and successful archive inspection. The W2 full-restore rehearsal is evidence of recoverability, not a substitute for this fresh backup. Preserve all earlier backups.
2. Export the exact API commit into a new `/var/www/jlpt-releases/<commit>` directory. Install its own dependencies using `npm ci`, generate its own Prisma client, and build. **Never reuse or regenerate the old release's shared node_modules.** Copy/reuse protected production configuration without printing secrets; retain OAuth, session, scheduler and database settings.
3. Inspect Prisma migration status and apply the single compatible foundation migration through `prisma migrate deploy` using the new release. Do not use `db push`, reset, down migrations or a schema copied from a test database. Verify all pre-existing learning/history IDs remain and the new billing tables start empty.
4. Keep `salesEnabled`, `enforcementEnabled` and `rewardsEnabled` false and `launchAt`/`enforcementAt` null. Existing sessions remain exempt from later enforcement through the locked cutoff contract.
5. Run the source/content steps below from the new release, first as dry runs. Validate exact source guards and current translation coverage before committing each operation. No test users, provider evaluation fixtures or private sandbox histories are imported.

```sh
npx tsx scripts/content-localization/correct-sources.ts
npx tsx scripts/content-localization/correct-sources.ts --commit
npx tsx scripts/content-localization/prepare-scenarios.ts
npx tsx scripts/content-localization/prepare-scenarios.ts --commit
npx tsx scripts/content-localization/manage.ts --apply
npx tsx scripts/content-localization/manage.ts --apply --commit
```

The source corrector handles old or absent English translations atomically and retains historical hashes. Use `manage.ts --report <protected-report-path>` to confirm 546 current validated entries and no missing/stale current translations. Inspect any unexpected count rather than forcing an import.

## Configure and switch compatible services

Use the existing authorized Stripe account and live credentials from protected configuration. Verify the account identity and live/test mode before creating only the approved one-time products/prices. Store returned price IDs in the matching environment variables. Preserve old/test prices and orders. New quotes use `CARD_ONLY_V1`; do not change account-wide payment methods or the existing Climate contribution as part of this release.

Register and verify the live endpoint `/api/v1/billing/webhooks/stripe` with the events consumed by `stripe-webhook.service.ts`; store its signing secret privately. Configure `BILLING_ENVIRONMENT=live`, verify all price currency/amount/recurrence fields through Stripe, and confirm the SDK/endpoint API versions are compatible. A Checkout return URL alone is never evidence of payment. Do not make an unapproved real-money purchase merely to smoke-test the endpoint.

Switch the API release symlink and reload the existing PM2 process with the matching protected environment. Check health, authentication, catalog, current study sessions, history and member APIs before deploying the paired Web commit. Verify Wrangler's account, then use the repository's deployment command with the production API URL. Record the resulting Worker deployment version. CI pushes alone do not deploy either service.

## Activate once and verify

Only after quality acceptance, the resolved pricing decision, live configuration and paired-service checks: write one immutable UTC `launchAt` and `enforcementAt`, enable the approved sales/allowance behavior, and leave Web rewards disabled. A repeated activation must preserve the original timestamps and the shared 90-day offer deadline.

Create/verify the designated user's idempotent `LAUNCH_GIFT` through `EntitlementService.ensureGift` while holding that user's billing lock. It starts at `launchAt`, ends exactly 365 days later and has source key `launch-vip:leo.ezra.shayne@gmail.com`; no administrator role or fake order is involved. Existing renewal and historical grant records must remain intact.

Verify Chinese/English learning, history snapshots, three-assessment limit, fifth/sixth-task boundary, card-only Checkout configuration, quote deadline, successful webhook processing and membership display. Use the proven sandbox for financial test flows; report separately whether any actual live customer purchase has occurred. Record actual deployment, activation and grant results without secret values.

## Operational rollback

Close new sales and rewards if their integrations fail; keep existing valid member access and all new records. Prefer a compatible API fix or configuration rollback. Record both old and new API/Worker versions before switching anything. Do not restore a stale database backup over new orders or learning history as an ordinary code rollback. A disaster restore requires a current backup and reconciliation of all post-backup orders, entitlements and learning records.
