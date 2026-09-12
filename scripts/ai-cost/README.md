# W2 runtime AI and cost acceptance — 2026-09-13

**Release decision: NOT APPROVED for live charging.** Runtime metering and language plumbing are implemented; candidate model quality and membership economics have material unresolved failures. No production model defaults, prices, quotas, or billing activation flags were changed. These are **synthetic workload estimates, not a forecast of real users' year-long behavior**. F must independently verify the evidence; developer tests are not independent acceptance.

## Runtime changes and compatibility

- Grammar input takes the immutable StudySession.explanationLocale; saved AiReviewResult includes explanationLocale and localizedFeedback. Vocabulary generation and every correction take the immutable VocabularyPractice language, including restored frozen inputs. User preference changes do not rewrite previous results.
- Japanese sentences/readings remain Japanese; English explanations, corrections, prompts, hints and translations use the same semantic schemas. Old `*Zh` / `*_zh` wire keys stay for compatibility and contain the selected language for newly generated records; consumers must prefer the additive locale-labelled fields. Old records with no locale remain Chinese. Chinese supplementary gloss and original English dictionary gloss are retained separately.
- Vocabulary public `localized={locale,prompt,meaningHint?,referenceTranslation?}` exposes meaning only at hintLevel>=1, reference translation only after completion. Unknown-word preview additionally has `localized={locale,meaning,exampleTranslation}`; result and attempt history use `localizedFeedback={locale,explanation,correctedTranslation,corrections}`. Internal input/sense/challenge never spreads into public responses. No memory/quota transaction semantics were changed.
- A single MeteredAiClient performs every grammar/vocabulary provider call. It commits an `AiUsageRecord` with `AI_IN_FLIGHT`, `success=false` and null usage/cost **before any network request**. Success, HTTP failures, schema failures, timeouts and provider fallback each finalize their own receipt; worker retries create distinct UUID receipts. Metering admission/finalization failure is nonretryable and fails closed. Interrupted receipts remain visibly incomplete for reconciliation.
- Raw storage is an allowlist of numeric provider usage fields only. No key, prompt, answer, HTTP error body or thought signature enters usage rows. Public provider errors omit bodies. Synchronous smoke scripts now require the same Prisma recorder. Server-only synthetic evaluation may use fsynced append-only 0600 file receipts; application runtime never uses that adapter.
- Existing first-result columns continue to contain the first successful evidence. Additional corrections do not reschedule grammar/vocabulary memory; no billing code, schema, migration or shared contract was changed.

## Token and pricing semantics

The pinned version is `2026-09-13-standard-text-v1`. Gemini prompt tokens include cached input, visible candidates exclude thoughts, and total=prompt+visible+thoughts. Its billed output is `total-input`, so thoughts are charged once. DeepSeek completion tokens already include reasoning, so thinking is not added again. Null thinking/cache-write counters stay null; a reconciled total can still prove the aggregate billed token coverage. Missing cache-hit counts use full input price as a conservative estimate, not a fabricated recorded zero. Nonzero unpriced cache-write usage, unknown models, missing usage and inconsistent totals produce **null cost**.

All rates below are paid standard text prices per million tokens, regardless of actual free allowances:

| Model                                                           | Input miss | Input cache hit | Output including thinking |
| --------------------------------------------------------------- | ---------: | --------------: | ------------------------: |
| DeepSeek Flash peak                                             |      $0.30 |          $0.006 |                     $1.20 |
| DeepSeek Flash off-peak                                         |      $0.15 |          $0.003 |                     $0.60 |
| Gemini 3.5 Flash                                                |      $1.50 |           $0.15 |                     $9.00 |
| Gemini 3.1 Flash Lite                                           |      $0.25 |          $0.025 |                     $1.50 |
| Gemini 3.5 Flash Lite, priced but not evaluated                 |      $0.30 |           $0.03 |                     $2.50 |
| Gemini 2.5 Flash Lite, unavailable in observed generation calls |      $0.10 |           $0.01 |                     $0.40 |

Verified primary sources: [DeepSeek pricing and peak windows](https://api-docs.deepseek.com/quick_start/pricing/), [Gemini paid pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini usage metadata](https://ai.google.dev/api/generate-content#UsageMetadata), [Gemini thinking configuration](https://ai.google.dev/gemini-api/docs/thinking). DeepSeek peak windows are UTC weekdays 01:00–04:00 and 06:00–10:00. DeepSeek requests explicitly disable thinking; Gemini 3.1 Lite uses minimal, 3.5 Flash low, and the unavailable 2.5 candidate uses budget 0. No model was promoted to default.

Actual legacy probe: two requests specifying `deepseek-chat` returned response model `deepseek-flash` and were billed using that observed identity (`results-legacy-probe.json`, `usage-legacy-probe.json`). Unknown aliases are otherwise not assigned guessed rates.

## Observed quality and availability

Artifacts are immutable named runs. `regression.ts` contains exact synthetic inputs, expected original-target evidence and scoring boundaries. Each result joins its usage row using runId/model/locale/case in taskKey; rows include provider request UUID, normalized and original usage, latency and paid-price estimate. `synthetic-raw-*.json` contains generated final text for inspection, with thought signatures/content omitted. Do not equate `passed:true` structural assertions with semantic certification.

| Run                                        | Observations                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DeepSeek initial, 28 calls                 | 25 structured outputs, 3 charged schema failures. Two structured grammar outputs falsely awarded 100 to `音楽を聞くながら料理をします。` in zh/en. F found another nominally passing English generation instructing the learner to answer in English. Therefore only 22/28 are provisionally usable; not qualified.                 |
| DeepSeek targeted v2, 8 calls              | English connection fixed; Chinese connection still silently corrected and marked 100. Three schema failures exposed extra kana ruby or a legitimate polite verb form missing from lexical recognition. Original failed outputs are retained.                                                                                        |
| Gemini local, 56 calls                     | All rejected 403 without usage. Safe diagnostic identified `API_KEY_IP_ADDRESS_BLOCKED`; no key restrictions were changed.                                                                                                                                                                                                          |
| Gemini server initial, 56 calls            | 2.5 Lite: 28 generation 404s despite appearing in models list. 3.5 Flash: 25 HTTP 429s, 1 charged invalid result, 2 successes. Actual project is free tier, confirmed by main; safe quota reason is 20 generate requests per model per project per day. No paid reliability claim.                                                  |
| Gemini 3.1 Lite v2, 14 of planned 16 calls | 11 structured successes, 2 charged invalid results, then a 429 and remaining 2 skipped. Both invalid results replaced 聞 with 聴 only in furigana; one also supplied total55 while components summed65. Existing strict checks rejected them. English vocabulary assessments are incomplete, so this model is not qualified either. |

Final generic repairs explicitly require Japanese answers, forbid kana-only ruby, recognize complete honorific verb phrases without accepting bare stems, and reject a result that silently changes an answer marked fully correct. These do not loosen scoring, furigana equality or evidence constraints. `results-final-targeted.json` / corresponding usage record the bounded post-repair check; they do not overwrite failed earlier runs. Remaining semantic mistakes require prompt/model evaluation and independent review, not hidden member restrictions.

A concrete measured hidden-cost example: Gemini 3.5 English vocabulary generation returned input546, visible196, thinking901, total1643. Paid-price cost is `546*1.5/M + (196+901)*9/M = $0.010692`, not $0.002583. Its successful free-tier API request does not make projected production cost zero.

## Reproducible economics

Run `npx tsx scripts/ai-cost/economics.ts`; `economics.json` includes all 20/40/120/240 corrections/day, both day passes, USD launch/standard annual and JPY annual, grammar/vocabulary shares 0/50/100%, generation per vocabulary correction 1/3 versus 1, peak/off-peak, measured-cache/cold-cache, and 0/1/5/10 free users per payer.

Base exchange values **are sensitivity assumptions, not market quotes**: 150 JPY/USD and 7.2 CNY/USD. Adjust them in the script; report sensitivity ranges are 130/150/170 JPY and 6.5/7.2/8 CNY. Net card receipts include Stripe Japan 3.6%, account's existing Climate 1%, plus 2% for USD requiring conversion. If no FX conversion is needed, remove that 2%. [Stripe Japan standard card fees](https://stripe.com/jp/pricing). Main is restricting new quotes to card; older quotes or other payment methods need separate actual fees.

| Product                   |               Paid-price net at base FX |
| ------------------------- | --------------------------------------: |
| USD 64 annual launch      |     $59.776 with FX; $61.056 without FX |
| USD 99.99 annual standard | $93.39066 with FX; $95.39046 without FX |
| JPY 6400 annual           |                                 $40.704 |
| USD 0.99 day pass         |   $0.92466 with FX; $0.94446 without FX |
| JPY 100 day pass          |                                  $0.636 |

Fixed infrastructure uses Tencent's **current renewal quote**, not historical payments, 40 CNY/month (480/year), plus conservative Workers standard $5/month. This equals $126.67/year at base FX. Tencent instance verified by main: Tokyo 2-core/2GB/40GB SSD. Workers actual invoice could not be read; main confirmed usage model standard, with no KV/D1 bindings. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) includes 10M dynamic requests/month and 30M CPU-ms/month; excess costs `max(0,requestsMillion-10)*$0.30 + max(0,cpuMsMillion-30)*$0.02`. Static assets do not add request charges. Domains, extra backups, taxes, refunds, acquisition and other unverified costs are **not confirmed zero** and must be added; positive cash contribution is not net profit.

The table below is a **peak / cold-cache stress scenario** with 50% grammar and 50% vocabulary, one new question per vocabulary correction. It counts measured charged invalid outputs and known human-rejected examples in the cost per accepted result. Do not assume everyone reuses each task three times.

| Corrections/day | DS annual AI | Gemini 3.1 Lite annual AI* | DS day AI | Lite day AI* |
| --------------: | -----------: | -------------------------: | --------: | -----------: |
|              20 |        $7.26 |                      $6.53 |    $0.020 |       $0.018 |
|              40 |       $14.51 |                     $13.05 |    $0.040 |       $0.036 |
|             120 |       $43.54 |                     $39.16 |    $0.119 |       $0.107 |
|             240 |       $87.08 |                     $78.31 |    $0.239 |       $0.215 |

_Lite is based on incomplete quality/availability evidence, including only Chinese vocabulary assessments; unknown rejected-call costs remain unpriced. These are illustrative known-cost lower bounds, not a qualified routing proposal._

At 240/day, AI alone exceeds USD launch net by $27.30 (DS) / $18.54 (Lite) and JPY year net by $46.38 / $37.61. At 120/day DS also exceeds JPY annual net by $2.84. Standard USD annual leaves only $6.31 (DS) / $15.08 (Lite) at 240/day before infrastructure/free users/unknown costs. All-vocabulary cold-cache stress is worse. Daily products cover the sampled per-day AI cost at these four levels, but this is not evidence for arbitrary usage or provider reliability.

Free-user sensitivity assumes the full agreed five tasks and three successful corrections/task daily, with five generations if all vocabulary, not a new member limit. In the DS 40/day, 50/50, cold-cache peak launch-year scenario, infrastructure breaks even at 3 payers with no free users, 4 at one free user/payer, 6 at five, and 25 at ten. For ten payers each carrying five fully active free users, illustrative annual cash margin is $12.56 per payer before unknown extras. If paid contribution minus free usage is negative, adding more similarly behaving payers never pays the fixed cost; `breakevenPayingUsers=null` explicitly represents this.

At 130/150/170 JPY/USD, JPY annual net is $46.97/$40.70/$35.92. Fixed Tencent+Workers annual is $133.85/$126.67/$120 at 6.5/7.2/8 CNY/USD, before unverified extras. This sensitivity alone materially affects the low JPY annual price. A model routing optimization must earn quality acceptance first and recalculate failure/fallback cost; no economical routing is approved by this report.

## Failure accounting, audit scope, and remaining acceptance

`success=false` with complete usage (e.g. invalid schema) still has a paid cost. HTTP403/404/429 without usage and interrupted network calls have null usage/cost, never zero. Current audits cannot establish their actual billed charge from an invoice. Economics sums known paid estimates and clearly labels unknown calls; it does not claim complete provider-invoice reconciliation. A startup/operations query should inspect old `AI_IN_FLIGHT` receipts and any `usageComplete=false` or `costUsd=null` before interpreting revenue margins.

The C static corpus audit (92 calls, estimated $0.06569925) is a one-time localization cost and excluded from per-session runtime estimates. No paid acquisition, Android Google fees or ads revenue is assumed. Android is a later acceptance stage.

Required before real charging: independent F checks of language/evidence/cost, a quality-qualified provider route, resolution of current Gemini free-tier availability, an explicit business decision about the material heavy-usage annual losses, and main's payment/deployment acceptance. No daily cap or extra subscription rule was introduced.

## Verification and delivered audit

Final build, source line limit, targeted ESLint and git diff whitespace checks pass. Local unit tests: 50 suites / 396 tests. Local database integration: 14 suites / 65 tests, including durable receipt-before-network, charged invalid results, distinct retries and unknown network failure costs. Existing pg concurrent-query deprecation belongs to the test harness. Separate tests cover immutable English grammar snapshot, vocabulary public hint/reference gates, original-target evidence, English/Japanese task boundary, complete thinking/cache normalization and fail-closed recording.

`usage-all-evaluation.json` consolidates 174 unique synthetic evaluation calls (112 unknown-cost rejections; known paid-price sum $0.035079516), including unsuccessful probes and both local and main-operated server batches. A separate main-operated one-request server quota diagnostic is outside this sum, explicitly documented in the audit scope. The final bounded DeepSeek repair run yielded 6 of 8 structured accepted outputs; the Chinese silent-correction error is now rejected as AI_INCONSISTENT_EVIDENCE, and one Chinese vocabulary result still fails schema. Fail-closed rejection protects learning evidence but does not mean provider quality or availability has passed.

## Bounded repair follow-up

See [REPAIR_ACCEPTANCE.md](REPAIR_ACCEPTANCE.md) for the current 2-call runtime policy, all v3–v6 rejected attempts and recalculated economics. The original results in this README remain archival. Current candidate is not qualified; semantic false positives persist.

See [THINKING_ACCEPTANCE.md](THINKING_ACCEPTANCE.md) for the separately authorized thinking-low comparison, complete rejected-attempt costs and latency. It is not a qualified default.
