# Annual Google license TEST acceptance — 2026-09-13

One annual purchase was completed at 07:36:10.191 UTC using Google's explicitly
labeled always-approve test card and no-charge sheet. The visible product was
365 days, JPY 9,824 discounted from JPY 15,200. Prior SDK guards required exact
`com.meritledger.app / jlpt_year_pass / buy / launch-64`, quantity and synthetic
account checks were independently enforced against Google's Products V2/Orders.

The frozen v4 standalone instrumentation APK SHA-256 was
`be81014b2200c74cc00c6e2dd3ee50131c94cbae7cecfffb428defb861a0893d`.
It was signed using the previously verified upload identity, installed only as
`com.meritledger.app.test`, and targeted the existing version23 TWA preview.
One explicit purchase confirmation was made after reviewing the exact price,
test card and no-charge notice. No real card or charge was used.

## Actual service results in the isolated local database

- Google authoritative `testPurchaseContext.fopType=TEST`, exact offer, price,
  owner and order/token binding passed before mutations.
- 07:36:43.582 UTC: one PAID order, one ACTIVE grant, 31,536,000 seconds,
  CONSUMED. Grant interval 2026-09-13T07:36:10.191Z through
  2027-09-13T07:36:10.191Z. Re-enqueue/reconcile did not extend the grant.
- The guarded refund plan required the same fresh TEST/consumed pinned order,
  full JPY 9,824 and one matching paid ledger. An exclusive refund intent was
  written before the only refund POST; Google returned HTTP success.
- 07:38:46.037 UTC: fresh Google REFUNDED evidence accepted, one REFUNDED order
  with full reversal and one REVOKED grant. Running reconciliation twice
  preserved the same interval and produced no duplicate grant/refund.
- Private input/output/pin/plan/evidence remain in the protected temporary run
  directory; purchase tokens, order IDs and credentials are not copied here.
- Independent production read at 07:37:36 UTC found no production user matching
  the synthetic account and zero related production orders/grants. This is
  isolated-service acceptance, not annual RTDN or final release acceptance.

## Failed preparations and device preservation

v2 failed on a desugared timezone class; v3 reached the exact offer query but
failed on an AndroidX superclass method. Both stopped before the single-launch
marker, payment sheet and purchase output. Their known transfer files were
cleaned, local databases retained. v4 removed the j$ runtime and aligned the
shared AndroidX dependencies without repackaging the target application.

An Android Studio debug run replaced the test package while main was working.
The user confirmed that run and stopped it. Main then removed only the test
package, installed the verified v4 signature and performed the successful test.
After acceptance, the known run transfer files and test package were removed;
the target app remained version23 / 2.0.0-twa-preview and its learning action
was restored. No target uninstall, clearing, account switch or credential edit
was performed. No production native sales/reward gate was opened.

The user now requests a joint UI adjustment once the candidate package is ready;
final package/Play submission must follow that collaboration.
