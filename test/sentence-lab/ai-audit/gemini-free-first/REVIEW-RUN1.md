# F independent real server batch 1 — Gemini free-first

**Core target/meaning/correction judgments: 12/12 passed F's bounded independent reading. Full Gemini coverage: NOT YET VERIFIED.** One Gemini Chinese grammar answer succeeded; the next Gemini call returned HTTP 503 and the shared circuit correctly moved subsequent operations to DeepSeek. Final mixed-route success must not be labelled full Gemini quality acceptance.

The main agent ran frozen inputs using candidate `55f1763` on the authorized server IP, in a fresh disposable PostgreSQL database, at `2026-09-12T23:19:58.281Z`. F performed no provider or production call and independently inspected all final Japanese sentences, readings, translations, error diagnoses and evidence flags, plus the rejected candidate. This is model-based independent review, not human linguist certification or comprehensive JLPT accuracy.

## Requests and accounting

12 operations produced **14 requests and 14 unique durable receipts**: Gemini two requests (one accepted, one HTTP 503), DeepSeek 12 requests (11 accepted, one validation rejection). Every available raw usage value matches the PostgreSQL normalized input/output/thinking/total. Thirteen requests have complete usage. The 503 has unknown usage and null cost; it is not counted as a free successful correction.

All known tokens, including the discarded DeepSeek generation, conservatively repriced on the approved DeepSeek peak/cold basis total **$0.0098496**, plus one request with unknown usage. Gemini thinking and DeepSeek reasoning are each included exactly once. This new batch does not replace the previously established annual-cost ranges or infer annual usage from 12 operations.

The rejected Chinese generation put ruby readings into phrase chunks. Server validation rejected it, the second paid attempt supplied plain chunks, and both receipts remain present. The successful Gemini connection-error candidate correctly rejected 書くやすい, identified the original literal span, corrected it to 書きやすい and explained the verb-stem rule in Chinese.

## Independent language/evidence review

Both natural grammar controls remained unchanged. Both connection errors were diagnosed against the original rather than the corrected answer. Both no-obligation translations retain permission not to print, rather than prohibition or inability. Natural vocabulary synonyms remain accepted as sentences while all target/meaning evidence stays null. Both wrong-sense answers are rejected and naturally corrected to drinking the glass of water in one go; the original failed target evidence remains false. Readings reproduce the Japanese sentences correctly; translations and explanatory fields use the requested locale. Both final generated challenges conceal the target in the scenario/hint, request Japanese answers and have references/readings/translations that match their target reservation sense.

Three diagnostic advisories are retained:

1. `zh:natural-control` (DeepSeek) returns `scenario_task_completed=true` despite no supplied scenario. The frozen mechanical audit reports this failure unchanged. F independently inspected the worker's trusted-context/session-ID guards and added a real-provider/worker/PostgreSQL test: with no server context/ID, this raw true value is persisted as **null**, so it cannot become scenario-memory evidence. The test passed. This is a contained raw-provider defect, not a false target or persisted scene-success result; no score or raw output was altered to obtain acceptance.
2. `zh:wrong-meaning` correctly rejects 予約 as drinking but calls it the object of 水. In the original, 予約 is the predicate. The detailed replacement and reason remain correct. This resembles the previously documented explanatory-position defect in DeepSeek outputs.
3. `en:wrong-meaning` correctly diagnoses the current sentence but overstates that water cannot be reserved. Reserving a water supply or delivery is possible; the relevant error is that reserving does not describe drinking the glass in one go. The core target rejection and corrected sentence remain correct.

These bounded diagnostic advisories do not invalidate the correct target/correction outcomes. They must remain visible rather than calling feedback flawless. The next frozen subset seeks actual Gemini coverage for English grammar plus both locales of vocabulary generation and assessment; any failed or unavailable Gemini attempt remains in the evidence, and no case is retried indefinitely to obtain a success.

## Artifact integrity

| File | SHA-256 |
|---|---|
| `run1/results.json` | `150f4dfc35295a70d7aa7068a24cf5ba6161337b874557b92c158c9dbbdd62ac` |
| `run1/raw.json` | `e9047844b7f025689bdb8dfdc416f8846ecf81bc7d69a7aaab885c95fd92f5e4` |
| `run1/usage.json` | `1dd335f15d5c1b390dcf606b9f060762b9ad1c331250e286d46ed6a2345ba4ff` |

`run1/mechanical-audit.json` preserves the original mechanical failure and its pending-semantic wording. This review adds the downstream containment evidence and actual independent judgment; it does not overwrite the raw provider record or rewrite the frozen expectations. No live billing activation is claimed here.
