# Learning v2 local validation and release preparation

This work does not apply migrations or publish builds to production.

## Validated application pair

Backend `dd5ad4e` and frontend `91e7809` are the matched implementation/test revisions.
Subsequent acceptance-document commits do not change application behavior. The web
baseline changes supplied by the user were preserved separately in `5fe5c0d`.

Final coverage: 183 backend unit tests, 30 real PostgreSQL integration tests,
25 frontend unit/component tests, 135 mocked desktop/mobile browser cases and six
real-stack browser cases. Both builds, type checks, lint and source line limits pass.
The real-stack runner applies all 14 migrations to its own temporary database and
uses real HTTP, sessions, CORS, polling and persistence. Only external AI results
are synthetic in that suite; four separate live-provider cases passed.

Live observations: 2,183–4,076 ms per request; 1,059–1,287 input and 422–634 output
tokens. These are four synthetic sentences, not a production latency SLA or a
long-term memory efficacy study. No configured monetary acceptance threshold was
provided; token usage is recorded for subsequent billing review.

## Local environment

Use an explicitly selected local/test PostgreSQL database. The implementation's
persistent rehearsal database is `jlpt_v2_integration_20260910`, containing a
separate `learning-v2-tester` account, four current plans, reference vocabulary and
private candidate imports. It is not a copy of production user data.

Production AI configuration was read over the existing authenticated SSH connection
with the user's explicit authorization and copied only into the ignored local `.env`
(mode 0600). No key material belongs in git, logs, fixtures or frontend builds.
The existing Gemini key has an IP restriction; local smoke tests use DeepSeek via
`AI_PRIMARY_PROVIDER=DEEPSEEK`. Production defaults to GEMINI and its restrictions
remain unchanged. Live AI validation uses synthetic sentences, not private documents.

All app starts for rehearsal must explicitly set `DATABASE_URL`, `FRONTEND_URL`,
`PORT` and `AI_WORKER_ENABLED`. Keep the worker disabled during synthetic fixture tests.
Use `NEXT_PUBLIC_API_URL=http://127.0.0.1:4600/api/v1` for an interactive local frontend
build. Never use the production API URL for mutation-based browser tests.

## Repeatable checks

- `npm run test:migration` creates a randomly named local PostgreSQL database,
  loads old fixtures, applies additive migrations, checks history and concurrent
  uniqueness, and removes only that database. Optional `TEST_DATABASE_ADMIN_URL`
  accepts a local host only.
- Backend `npm test -- --runInBand`, `npm run build`, `npm run check:lines`.
- `npm run test:integration` runs the real PostgreSQL HTTP/concurrency/evidence and
  administrator rollout suite. Its isolated random databases are removed afterward.
- Frontend `npm run typecheck`, `npm test -- --run`, `npm run build`,
  `npm run check:lines`, then configured Playwright desktop/mobile projects.
- `npm run test:ai:live -- --output /absolute/path/ai-smoke.json` makes four bounded
  real AI calls using local backend configuration. This is an explicit paid smoke
  check, excluded from routine tests. Synthetic AI fixtures and real calls are separate.
- Frontend `npm run test:e2e:real` builds and tests a real API/Next/PostgreSQL pair.
  Run from isolated checkouts without `.env` files, setting `REAL_API_DIR` and an
  outside-repository `REAL_QA_DIR`; see the frontend `scripts/real-stack/README.md`.
  The default mock browser suite excludes these database-dependent cases.

Local screenshots and runner evidence are retained under
`/Users/shen/Downloads/jlpt/.implementation/qa/`, including
`real-today-mobile-320.png`, `real-feedback-desktop.png`,
`real-reveal-mobile-320.png` and `real-private-import-mobile-320.png`.

## Data preparation

See `scripts/content/README.md` for reproducible open-reference downloads and
private extraction. Dictionary versions, checksums, mapping revisions, licences and
source locations are retained. Reference classifications are not official JLPT
syllabi and no exam-frequency ranking is inferred. Original dictionary glosses and
supplemental Chinese glosses remain separate.

The first full reference import contains 7,582 mapped words / 15,407 distinct
sense-and-reading rows. The supplied XLS, readable DOC and phrase PDF yielded
2,264 candidate rows; 2,253 remain after duplicate suppression. All private rows
are PENDING and require source verification before commit/use. Scanned OCR is deferred.
Repeat imports preserve IDs and bookmarks and do not multiply rows.

## Controlled enablement

`User.learningV2Enabled` defaults false. An authenticated administrator can PATCH
`/api/v1/admin/learning-v2/users/:id` with `{"enabled":true}` for an explicitly chosen
account. This is not a user-editable preference. Stage 2 evidence must remain gated
until server scene assignment and validated task-completion evidence are available.
No historical record is inferred to have passed a scene-transfer check.

`GET /api/v1/admin/learning-v2/metrics?days=7` reports duplicate open reviews, today's
budget overruns, AI job outcomes and latency/token counts, target-evidence mismatches,
invalid transfer flags and lapses after stable memory. Token totals are observed usage;
monetary cost depends on the selected provider's billing and is not fabricated.
The existing review-algorithm metrics remain available for calibration. Short runs
validate implementation, not long-term improvements in recall.

## Deployment order for a separately authorized release

1. Back up the production database and rehearse these exact migrations against an
   isolated restored copy. Record counts, migration IDs and paired application revisions.
2. Apply the enum migration separately before migrations that use ARCHIVED. Additive
   schema, archival/dedup updates and new API compatibility routes precede the frontend.
3. Deploy the new backend with per-user mastery rollout disabled; validate the old
   current-plan endpoints against the primary goal and list endpoints against all levels.
4. Deploy the paired frontend; verify the chosen pilot accounts, then enable strict
   evidence only for those accounts. Check metrics and source-selection correctness.
5. Expand the rollout only after review. The current task does not perform these steps.

## Rollback

Disable the selected users' learningV2Enabled flag to return to the retained legacy
memory path while preserving all new events and content. Keep the compatible new API
and additive schema when reverting the frontend. The current-plan routes map to the
primary plan and continue to serve older clients.

Do not blindly deploy the original pre-v2 backend against new multi-plan state: its
create-plan behavior pauses unrelated levels and is incompatible with the new unique
current-plan invariant. A backend rollback must use a paired compatibility build that
retains the new plan constraints/routes. Do not reverse the migrations by deleting
plans, content, activity ledgers or learning records.
