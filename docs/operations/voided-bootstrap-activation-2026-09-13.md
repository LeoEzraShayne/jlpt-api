# Voided-purchase bootstrap activation — 2026-09-13

The main agent reviewed and deployed the retention-boundary fix as API release
`b9eef571bcf22203b91f18015212d20428825f56`. This was a guarded code-only deployment:
no migration, credential rotation or native gate activation. Main reports
deployment completion at 07:33:01 UTC.

The old sync row still had null watermark/last-success timestamps and the earlier
`GOOGLE_VOIDED_SYNC_FAILED`. Since the newly started process's hourly job had not
yet run, main reviewed and executed the fixed-version one-shot runner once. It
called the actual deployed `GoogleNotificationsService.syncVoided()` through its
normal leases and durable-record logic, without starting a second scheduler or
manually setting the watermark. Runner SHA-256:
`9478b37f7e5ba4429556c30f82015fa761318f8ce6a45263b05cfb8c06dd5305`.

Main's execution result at 07:41:47 UTC was `SYNC_SUCCEEDED`: one OAuth request,
one voided-purchase GET and three enqueue calls. The runner exposed only the
deployed enqueue implementation and blocked other Google URLs, including consume
and refund. Its exclusive attempt marker remains in place; no blind rerun is
authorized. The existing PM2 queue worker continued normally.

## Independent read-only verification, 07:42:44.787 UTC

- Runtime is the expected `b9eef571` release, PM2 online.
- Sync watermark: `2026-09-13T07:41:47.181Z`; last success:
  `2026-09-13T07:41:47.688Z`; error and lease are cleared.
- Exactly three Google live `VOIDED_SYNC` events created in this run's bounded
  execution interval are `PROCESSED`, with no error.
- Their three linked queue rows are all `IGNORED_TEST`, consumption
  `NOT_APPLICABLE`, no error, no linked user and no linked payment order.
- The known annual TEST run's synthetic obfuscated account was read privately
  from its protected input. It does not exist in production: corresponding live
  orders and entitlement grants are both zero. No identity, token, order ID or
  credential was printed.
- All three runtime Android gates and both DB native sales/reward gates remain
  false. Main's runner also verified the complete BillingConfig and protected
  environment file were unchanged.

This completes the first actual production bootstrap and confirms normal-worker
convergence for the three TEST references. It is not evidence of a completed
hourly scheduled run, a real customer refund, an annual RTDN purchase/refund
scenario, enabled Android commerce, or Google Play submission. The independent
verification performed no writes, manual drain, consumption or refund.
