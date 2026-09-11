# Daily scheduling without a time budget — 2026-09-11

Daily time is now observational, not an admission limit. The shared allocator used by daily task generation and multi-plan forecasts includes all eligible due reviews and initial checks, plus each SYSTEM plan’s remaining dailyNewLimit. Reviews retain their priority; new learning still waits for required reviews in its own group. GAP_FILL, pause/start-date filtering, completed-work preservation, task idempotency and activity recording remain intact.

The UI removes daily time and share controls, available-time/reservation/overrun metrics, and budget messages. Estimated and actual study time remain visible. The primary level still determines the primary learning group.

Compatibility: existing dailyMinutes and primaryShare fields remain stored and accepted, but have no scheduling effect. POST /study-plans now accepts omitted dailyMinutes (legacy stored default 20). Dashboard planning/allocation report timeLimited: false. Legacy numeric budget/remaining/overrun fields are zero compatibility placeholders, not remaining capacity. Forecast capacityMinutes is likewise a deprecated zero placeholder; forecast scope is ACTIVE_PLANS. No migration or data deletion is required.

Verification: 186 unit tests, 36 isolated PostgreSQL integration tests, including 15 due reviews with 117.65 actual minutes plus an active-session reservation, concurrent refresh/idempotency, new-item limits, paused plans, forecast parity and preserved activity. Frontend: lint, build, typecheck, 25 component/unit tests and 28 desktop/mobile E2E cases.

Deployment order: API before web, since the new web omits dailyMinutes when creating a plan. Roll back both revisions together if necessary; retain all activity, tasks and learning records.
