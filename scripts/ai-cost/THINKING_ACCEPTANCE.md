# DeepSeek thinking comparison — 2026-09-13 JST

**Not qualified for release.** Thinking low removes the previously observed grammar false positives in the returned development samples, but strict availability is 50/52 operations across two batches and independent F acceptance remains pending. It also materially worsens economics. No default model, production configuration, sales state or member limit was changed.

## Official configuration and scope

Primary sources rechecked for this follow-up: [thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/), [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/), [paid pricing](https://api-docs.deepseek.com/quick_start/pricing/). Current model is `deepseek-flash` (V4.1 Flash), supporting enabled/disabled thinking and low/high/max effort. The tested request explicitly sets `thinking.type=enabled`, `reasoning_effort=low`, `max_tokens=4096`, JSON output; temperature is omitted because it does not apply in thinking mode. The existing 20-second network timeout remains. This finite output allowance is a tested candidate configuration, not the model's maximum capability.

The optional internal `DEEPSEEK_THINKING_EFFORT` config enables only supported values; omission keeps explicit disabled behavior. Harness `--thinking=low` sets it only in the synthetic ConfigService. Main owns any environment-schema integration; no .env/default changes are included. No reasoning text is retained: only final candidate text and numeric usage. Strict score/furigana/language/evidence validation is unchanged. All repairs use the same two-call operation budget.

Batch1 is the original28-operation development regression, suitable for direct comparison with bounded-repair-v6. Batch2 is a new24-operation transfer set frozen in `transfer-corpus.ts` before calls, covering four grammar patterns, local connection mistakes, missing target despite a natural alternative, and a new vocabulary sense in both languages. This is a new development set, **not F's held-out set**.

## Results and rejected attempts

| Batch | Operations | Calls | First candidates rejected | Repair recovered | Final structural/expected success | Paid estimate, all attempts |
|---|---:|---:|---:|---:|---:|---:|
| Same corpus, thinking-low-v1 | 28 | 32 | 4 (14.29%) | 3 | 27/28 | $.032638422 |
| New transfer, thinking-low-transfer-v1 | 24 | 28 | 4 (16.67%) | 3 | 23/24 | $.026007936 |

All60 calls have complete usage and non-null paid estimates: input55,429; inclusive completion92,103; reasoning78,879. Reasoning is already inside completion and is **not added again**. Total measured paid estimate $.058646358; totals include all10 rejected network attempts. Zero unknown costs in these two batches does not make earlier403/429/network-unknown records free. Prior non-thinking/Gemini failures remain archival and excluded from this policy's per-operation denominator.

Final failures:

- Same corpus zh wrong `ながら`: both candidates correctly identify the original connection error but render furigana with the following ordinary kana missing (`聞[き]ながら` does not reproduce `聞きながら`). Request IDs `b430164d-8b76-4fbe-9de5-b3d777c64e66` and `c2fb425f-609a-443a-809b-d4ba4f49d9b8`; paid $.002180436 combined. Strict rejection is required and is not a successful correction.
- Transfer zh missing target: both calls terminate with `finish_reason=length` at the candidate's4096 output limit. Request IDs `f7f155ee-71c5-40c3-82f6-290f30fdee40` and `3cb09c7e-7bee-4d16-8ba7-6b80209024ba`; paid $.004997040 combined. This demonstrates a token-budget/availability boundary, not a proven semantic inability under a larger budget.

Other first-attempt failures remain visible: three additional truncated outputs recovered on repair; two English grammar responses failed the language check and recovered; one other grammar schema rejection recovered. Do not report only the final successful samples.

Returned grammar samples correctly distinguish the invalid stem constructions and natural missing-target alternatives; the same-corpus English `ながら` now reports false correctness and59, rather than100. All24 returned vocabulary operations across both batches meet expected target/meaning assertions. These assertions plus this review still do not establish generalized accuracy or replace F.

Latency includes all network/receipt work: same corpus median operation5.951s, p95 23.444s, max25.519s; transfer median5.320s, p95 25.214s, max36.300s. Each request stayed below20s, but a repair adds a second request. Original-response latency alone understates learner wait. Same-corpus median/p95 operation latency by purpose: grammar9.286s/18.754s, vocabulary assessment2.133s/7.980s, vocabulary generation23.444s/25.519s (only4 generation operations). Per-purpose latency distributions are in repair-report JSON.

## Full-cost comparison and product implications

Same-corpus all-attempt cost per final expected success:

| Operation | Thinking observed USD | Thinking peak/cold USD | Disabled v6 peak/cold USD |
|---|---:|---:|---:|
| Grammar | .001570983 | .003278809 | .000684330 |
| Vocabulary assessment | .000326048 | .000902975 | .000607425 |
| Vocabulary generation | .002861261 | .005844825 | .000702000 |

Do not use the cheaper new transfer sample's generation cost as a guaranteed replacement; only two generations were sampled. `economics-thinking-low-v1.json` and `economics-thinking-low-transfer-v1.json` provide separately recomputable policy estimates without pooling unlike corpora. The original28 case comparison is the reference table below.

Peak/cold,50% vocabulary, one new generation per vocabulary correction; all charged repairs and rejected operations retained. Net prices deduct3.6% Japan card, actual1% Climate, plus2% FX for USD. FX inputs are JPY150/USD and CNY7.2/USD scenario parameters. Figures below are contribution after AI/payments **before fixed and unverified costs**.

| Corrections/day | Annual AI USD | $64 year | $99.99 year | JPY6400 year | $.99 day | JPY100 day |
|---|---:|---:|---:|---:|---:|---:|
| 20 | 36.60 | 23.18 | 56.79 | 4.11 | .8244 | .5357 |
| 40 | 73.19 | -13.42 | 20.20 | -32.49 | .7241 | .4355 |
| 120 | 219.58 | -159.81 | -126.19 | -178.88 | .3231 | .0344 |
| 240 | 439.17 | -379.39 | -345.77 | -398.46 | -.2785 | -.5672 |

Thus enabling thinking broadly does not support the existing unlimited price promises under these synthetic usage scenarios: launch annual already loses at40/day; heavy120+ loses at all annual prices; heavy240 also loses on both day tickets. Positive examples still need Tencent40CNY/month + conservative Workers$5/month allocation, free-user subsidy, unknown domain/backups/excess usage and other costs described in the baseline report. No limit, price or sales switch is changed. The all-vocabulary, generation-reuse, cache/time-band and free:paid ratio sensitivities remain in the calculation files rather than assuming every task is reused three times.

Bounded service rounds remain2 calls. Main's separate crash-safe worker repair allows automatic recovery at most3 rounds/6 calls and preserves one explicit manual recovery, lifecycle4 rounds/8 calls. Evaluations here run a single service round per operation, not every possible worker/manual retry. With this thinking configuration, two calls can emit at most8192 completion tokens ($.0098304 peak output alone, plus input); lifecycle8 can emit32768 ($.0393216 output alone, plus input). These are configured worst-output boundaries, not the measured mean, and are not member quota limits.

## Reproduction, validation and next boundary

```sh
npx tsx scripts/ai-cost/regression.ts --run --model=deepseek-flash --thinking=low --tag=unique-thinking-run
npx tsx scripts/ai-cost/regression.ts --run --model=deepseek-flash --thinking=low --transfer --tag=unique-transfer-run
npx tsx scripts/ai-cost/repair-report.ts --tag=unique-thinking-run
npx tsx scripts/ai-cost/economics.ts --run-tag=unique-thinking-run
```

Use the existing protected authorized isolated worktree environment only; DB/file-receipt safety guards still apply. Batches are28/24 operations and at most56/48 network calls. Final outputs, usage counters/request IDs, outcome logs and finite policy metadata are committed under each tag. No key, reasoning content, production DB or browser is involved.

404 unit tests and66 integration tests pass, with build/eslint/line checks. A new unit test verifies explicit supported thinking mode and finite output allowance; usage rejects impossible reasoning counters larger than inclusive completion. Remaining boundaries: furigana output consistency, capped generation completion, generalization beyond these development samples, independent F acceptance, and economics. A larger output allowance would require a new bounded cost/latency experiment; it must not be called a free repair or silently promoted to production. Broad thinking is not a release candidate on the present evidence.
