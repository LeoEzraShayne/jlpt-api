# Static English corpus — W1 C

## Delivered corpus and quality

`translations.en.jsonl` contains 546 source-bound translations: 223 grammar explanations/connection rules, 223 example translations, 6 relation titles/notes and 94 scenarios. The production snapshot had 62 scenarios; the existing runtime practice catalog could create another 32. `prepare-scenarios.ts` materializes all 82 catalog scenarios, retaining 12 existing legacy scenarios. No Chinese fallback is counted as English. Null optional source fields stay null; original Japanese, Chinese explanations and vocabulary original English/chineseGloss provenance remain intact.

Each batch received a translation pass and a separate meaning/connection/negation/register review pass, both using DeepSeek `deepseek-flash` with thinking disabled, followed by structural validation. This is model-reviewed content, not a claim of independent expert linguistic certification. The main/F acceptance remains required. The coding agent also spot-checked explanations, dictionary-form connections and scenario language.

`coverage.en.json` records complete current-plus-future-catalog coverage. `usage-audit.json` preserves every metered call (92 calls: 46 translation + 46 review; no failed, unknown-cost or usage-incomplete calls). Total 175,471 input + 65,631 output tokens, 0 reported cache-hit tokens, estimated $0.06569925. Reasoning/cache-write tokens were not returned and remain null; reasoning was explicitly disabled, and billed completion tokens already include any reasoning. No free-tier assumption. This one-time content cost does not replace D/F runtime membership-cost acceptance.

Pricing verified 2026-09-13 at https://api-docs.deepseek.com/quick_start/pricing/: DeepSeek Flash per million tokens cache miss $0.15 off-peak/$0.30 peak, cache hit $0.003/$0.006, output $0.60/$1.20. Peak UTC weekdays 01:00–04:00 and 06:00–10:00. All calls occurred off-peak. Requested current model is `deepseek-flash` (officially DeepSeek V4.1 Flash); runtime app model defaults were not changed. Provider fees can change; update the pinned pricing version before future runs.

## Operations (main agent only for production)

Dependencies are isolated (`npm ci`; Prisma generated locally). Scripts read protected `.env` by default. Set `DOTENV_CONFIG_PATH` explicitly for an alternate protected configuration; never copy connection strings into commands or artifacts.

1. Run `npx tsx scripts/content-localization/prepare-scenarios.ts` to preview the existing runtime catalog; add `--commit` to materialize it. This is required before applying the 32 future scenario translations.
2. Run `npx tsx scripts/content-localization/manage.ts --apply` for validation against live DB source IDs and current text hashes. Missing entities, duplicate artifacts, modified source text and invalid translation provenance fail closed.
3. Run `npx tsx scripts/content-localization/manage.ts --apply --commit` to import atomically. Import locks the four source tables against concurrent content edits, checks current hashes inside the transaction, and upserts the exact entity/type/locale/hash tuple. Re-running preserves the row count. It does not modify legacy grammar, examples, relationships, vocabulary or learning records.
4. Run `npx tsx scripts/content-localization/manage.ts --report /path/to/report.json` to compare the artifact with live corpus. `--source /path/to/public-static-snapshot.json` supports offline coverage only; it is forbidden for committed imports.
5. For fresh generation use `npx tsx scripts/content-localization/translate.ts --source /path/to/snapshot.json --run`. Default is preview. Completed artifact batches are checkpointed; reruns skip validated source hashes. All provider calls are recorded in `AiUsageRecord` **before** the request and updated before continuing; interruptions remain visibly incomplete. A metering failure aborts the run. There are no automatic unmetered retries. Failed batches can be resumed explicitly.

Production migration/schema is owned by main. No new C migration is required beyond W0 `ContentTranslation` and `AiUsageRecord`. Translation rollback may set newly imported records to DRAFT, keeping provenance and previous hash versions; never delete learning/order data. Usage records presently live in the isolated original content DB and the checked-in sanitized audit; main/D may ingest audit rows idempotently by requestId into the central cost dataset before production acceptance.

## API / integration

`ContentLocalizationModule` is imported by GrammarModule and SceneModule. `ContentLocalizationService.grammar([grammar], locale)` returns additive `localized` data on grammar, examples and relationship groups. Existing grammar-points list/detail accept `?locale=zh|en`, defaulting to account explanationLocale. `GET /training-scenarios?locale=zh|en` is authenticated and adds localization for active scenarios.

`localized` = `{requestedLocale, resolvedLocale, status, sourceHash, fields}`. Status ORIGINAL means Chinese source; VALIDATED means an exact current hash and structurally valid English; MISSING/STALE have `resolvedLocale:null,fields:null`, never mislabeled Chinese. Fields: GRAMMAR explanation/connectionRule/usageScene/commonErrors; EXAMPLE translation; RELATION title/notes; SCENARIO domain/objective/register/prompt. Grammar also adds `displayTitle` to translate Chinese parenthetical sense labels; original Japanese `title` remains intact.

`SceneService.assign(tx,userId,sessionId,grammar,explanationLocale='zh')` adds immutable trainingContext.explanationLocale, language-selected instruction and scenario.localized. Callers must pass the new session language. Old contexts stay compatible. Session read/reveal must call `.grammar()` with the stored session explanationLocale before `presentSession`. Hidden review responses explicitly redact `localized` to avoid leaking English answers. Main/A owns this session-service wiring; C did not modify their service.

Vocabulary English is already original dictionary glosses and Chinese enrichment remains separate; B should select glosses for English and chineseGloss for Chinese without relabeling missing glosses. No vocabulary data overwritten.

## Verification

- Build and targeted ESLint pass; full unit suite 46 suites / 378 tests passes.
- 21 localization/scene tests pass (source/context invalidation; placeholder/fallback/field validation; required review provenance; missing/stale reads; English reference redaction; existing scenario selection).
- Isolated empty `jlpt_sentence_lab_content_prodverify_20260913` loaded only public static source tables using `import-local-snapshot.ts` (hard-coded localhost/disposable DB guard).
- Import 546 translations twice -> still 546 rows; all 223 grammar reads and their examples resolve English.
- Transactional source mutation produces STALE with null fields; forced rollback restores the original source.
- Production and legacy local integration IDs differ: the first attempted local import correctly rejected SOURCE_ENTITY_MISSING, with no partial translation writes.

No production writes, browser operations, runtime model-default changes, schema changes, or secret exports were performed by C.
