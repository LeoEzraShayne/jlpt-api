# JLPT learning v2 implementation contract

## Baselines and ownership
Backend baseline: 636d4619f6411ff5c5e56d6ed62a5bfc124d6da5.
Frontend baseline: abb83b053b9a295e14553f2b2facd4eabf74d916.
The pre-existing frontend dashboard diff is protected outside either repository in
`.implementation/frontend-user-baseline.patch`. Its exact bytes were verified before
recording that existing work separately as web commit `5fe5c0d`; the new frontend
implementation follows in a separate commit and preserves it.
Baseline: API 72 tests passed; web 24 tests and typecheck passed.

Main owns schema, migrations, cross-client contracts, wiring and integration.
A owns plans/dashboard/preferences; B owns review evidence/session completion;
C owns private content/imports; D owns scenes/AI after B handoff;
E owns frontend; F owns independent integration and E2E verification.
At most three workers run concurrently, each in an isolated git worktree.

## Core invariants
- User.targetLevel remains the primary goal. User.dailyMinutes is a shared daily
  budget; User.primaryShare defaults to 80. Creating another plan never changes it.
- Current = ACTIVE or PAUSED. Unique per user and level, enforced by partial index.
- SYSTEM and GAP_FILL modes. Marking untouched grammar needsWork does not mark it learned.
- No more than one PENDING/IN_PROGRESS REVIEW task per user/grammar, regardless of date.
- Paused and future plans do not generate automatic tasks. Completed work, active
  reservations and extra practice consume budget; backlog does not become duplicate work.
- Primary and foundation pools each prioritize scheduled review then new learning;
  unspent capacity can be borrowed. Foundation backlog cannot lock primary new work.
- FSRS retention .90, maximum 365 days. No valid first-attempt assessment means no
  successful evidence or interval extension. Simple accurate sentences are valid.
- mastery-v2 requires three consecutive due reviews on distinct dates, first score
  >=80, correct target, no hints, REMEMBERED, >=one verified transfer, stability >=30d.
  Historical missing data stays missing. Mastery retains a next review date.
- Only the target receives review evidence. Auxiliary content receives exposure/use.
- Personal expressions and imported candidates are owner scoped. Import validation
  is explicit; uncertain labels/glosses cannot silently become published facts.

## Compatibility and rollout
Existing current-plan routes resolve the primary plan. New clients use the plan list
for onboarding, including paused plans. Schema additions precede client deployment.
User.learningV2Enabled defaults false and controls strict evidence rollout;
only a dedicated local test account is enabled during this implementation.
No production migration or deployment is part of this work.

## Migration invariants
Capture the old latest current plan's dailyMinutes once, never sum plan budgets.
Per level keep ACTIVE ahead of PAUSED, then newest updatedAt/id; archive extras.
Preserve all historical tasks, sessions, progress and old evidence versions.
Duplicate open review tasks are marked SKIPPED/MIGRATION_DEDUP, not deleted.
Rollback uses matched builds and feature controls; never destructive reverse migrations.

## Required verification
Unit: pools/borrowing/paused/future/budget adjustment; score79/80/hints/first attempt,
no score/early retry/different dates/cross-scenario/mastered lapse/overdue alone.
Database: migrate old fixtures and empty database; concurrent creates/completions;
owner isolation; duplicate imports; idempotent daily planning and open-review index.
Frontend: typecheck/build/component tests; desktop/mobile E2E including pause-all,
plan switching without primary replacement, hidden expressions and library CRUD.
AI: deterministic regression fixtures then a small real-call smoke if configured;
source failure must preserve basic correction. Report unexecuted checks explicitly.
