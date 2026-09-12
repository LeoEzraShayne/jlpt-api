# Vocabulary learning release

## Scope and evidence
Per-sense personal knowledge marks and contextual production practice. Manual REMEMBERED is authoritative; it is not an AI promise of permanent memory. A remembered sense can remain in production practice if the user chooses. Pausing or stopping never deletes history. Existing bookmarks are not enrolled automatically.

Known words are initially hidden. Hint stages reveal meaning, reading, word, then shuffled chunks. Unknown initial learning shows an example and cannot produce independent recall evidence. Word outcomes are assessed separately from grammar; using a natural alternative is UNVERIFIED, not a word error. Grammar-based tasks here do not write official grammar review evidence.

## Compatibility and migration
Migration `202609120001_vocabulary_learning` adds two tables and relations only, with a partial unique index on unfinished practices. No existing vocabulary, user sentences, schedules, marks, or grammar plans are deleted or rewritten. Old API consumers may ignore optional vocabulary.learning. New clients require the vocabulary-learning backend module before rollout.

Deployment order: database backup and verified restore listing → independent release Prisma client generation/build → apply additive migration → switch backend release → health and synthetic owned-account smoke → frontend deployment → public assets and viewport checks. Production and local schema migrations must match; production learning rows are not replaced by local data.

Rollback: switch to the preceding backend and frontend versions together. Retain the new tables and practice rows; never run a destructive down migration. A prior backend leaves queued vocabulary jobs idle and preserves data for the next rollout. Shared node_modules must not be regenerated in place because the previous release must keep its matching Prisma client.

## Required checks
- PostgreSQL concurrency and unique unfinished practice, ownership, private vocabulary visibility.
- Repeated manual status action, remembered/practice coexistence, pause/resume, per-sense separation.
- Immutable first answer; hint state across refresh; no hidden reference leakage; stale worker lease fences and manual revision fences.
- FSRS due and local-date evidence, assisted/unknown/incorrect/unverified outcomes, same-day and early practice.
- Fixed AI cases, live synthetic correct/incorrect/alternative cases; no raw credentials or learner sentences in deployment logs.
- Frontend typing/build/tests; desktop/mobile list marks, practice hints, ordering scaffold and feedback.

Long-term retention improvement requires actual spaced learning history. This release verifies workflow and evidence correctness; it cannot establish long-term benefit from a one-time smoke test.

## Local acceptance (2026-09-12)
Backend build, 372 unit tests, 53 real PostgreSQL integration tests, legacy migration rehearsal and targeted ESLint passed. Integration includes a non-UTC SQL session, stale-worker fencing, submitted failed hints and automatic next-item selection. Frontend typecheck, lint, production build and 35 unit tests passed; feature E2E covered 25 desktop/mobile cases, with 10 cases rerun after main integration. Synthetic live generation plus correct/incorrect/alternative assessments passed, including coherent sentence correction and Chinese learner-facing feedback.
