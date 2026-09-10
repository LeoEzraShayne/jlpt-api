# Agent C delivery

## Integration
- Add ContentModule to AppModule (main owns this). Main already adopted exact six-model proposal and generated shared client; no package/config modifications required.
- Read CONTRACT.md for authenticated endpoints and DTOs. Imported private sources are PENDING until explicit user validation and commit.
- D: `selectForPractice(userId, grammarId, level, sessionId?)` now rotates deterministically by session and avoids recent vocabulary exposures. Pass sessionId; fallback seed is UTC date. Persist returned content IDs/provenance in session context. Hide personal expressions during REVIEW; revealing must call the existing session hint path. `recordExposure` is idempotent and never contributes mastery evidence.
- Same-owner content candidate commit and validation use row locks so withdrawal cannot be overwritten by concurrent stale commit. Preview inserts candidates in one batch with unique owner/content fingerprints.

## Data ready outside repository
- Full reference: `/Users/shen/Downloads/jlpt/.implementation/content/reference-full.json`
- Counts: N1 3406, N2 1807, N3 1729, N4 640 mapped words; 15407 separate sense/reading records. Source is official JMdict gzip (2026-09-10), Waller/Tanos mapped IDs at recorded immutable GitHub revision. No official classification or exam-frequency claim.
- Cache + license snapshots: `/Users/shen/Downloads/jlpt/.implementation/content/cache/`
- Private candidate previews: `/Users/shen/Downloads/jlpt/.implementation/content/private-candidates/`
- Original XLS: 1415 rows across 3 preview files (`dc38acdaba04-*`); readable word-table DOC: 834 across 2 (`effc8a46961e-*`); phrase PDF: 15 (`91c57febfe92-1`). All PENDING, source checksums and row locations preserved. Raw originals unchanged; no private source payload committed.
- Main may import full reference into local/test DB with `npx tsx scripts/content/import-reference.ts FULL_PATH --commit`, and stage each private preview using `npx tsx scripts/content/import-private.ts PREVIEW_PATH --stage --user-id EXPLICIT_TEST_USER_ID`.
- Reference sample in repo: 100 mapped words / 191 senses plus attribution and CC-BY-SA-4.0 license.

## Validation completed in isolated worktree
- `npm test -- --runInBand src/content`: 4 suites, 15 tests passed.
- `npx tsc --noEmit --incremental false`: passed against main's generated client.
- `npm run build`: passed.
- Scoped ESLint for src/content and scripts/content TS: passed.
- `npm run check:lines`: 107 files checked; all within 500 lines.
- Full 15407-record reference JSON CLI validation passed without DB writes.
- Private XLS/DOC/PDF extraction performed successfully, preview CLI validation passed.

## Remaining integration checks owned by main/F
- Real PostgreSQL import/commit/concurrency/cross-user integration, HTTP routes with AuthModule, session integration and frontend library flows. This worktree did not access production or test credentials.
- No automatic semantic verification of user documents. Ambiguous readings, unreliable glosses and unverified levels require user review; structural failures cannot be marked VALIDATED until corrected and re-previewed.
- Dictionary updates retain old sense identities/bookmarks; withdrawing obsolete dictionary senses requires explicit content quality review. No automatic removal or separate vocabulary/phrase queues.
