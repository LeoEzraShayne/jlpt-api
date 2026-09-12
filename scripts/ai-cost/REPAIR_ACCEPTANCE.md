# Bounded repair evaluation — 2026-09-13 JST

Status: runtime repair is implemented and tested; **DeepSeek Flash remains unqualified for release**. These are synthetic scenario estimates, not forecasts of a real year of member behavior. Billing/default model/entitlement limits have not changed. Independent F acceptance is separate.

## Runtime policy

One service round has two network slots. A retryable structural/language/evidence failure spends the second slot on one same-provider repair; an availability failure may spend it on a configured fallback. A repair replaces fallback, never adds a third call. Missing provider keys are skipped and cannot overwrite the real error. Nonretryable metering failures stop immediately. Grammar's existing three worker rounds remain at most six ordinary network attempts; each vocabulary generation/assessment has at most two. Existing crash/lease handling is unchanged.

Every candidate, including rejected candidates and repair, retains a distinct pre-network receipt, requestId, attempt ordinal, usage and paid estimate. Receipt finalization occurs before retry. Model output is still strictly rejected for invalid score sums, furigana and evidence. Application code does not recompute scores. Repair feedback comes from fixed allowlisted validation categories, not raw model/error text. Repair asks for fresh evaluation of the original answer and preserves the session language. Prompt output has no restored expansion/cards.

The core instruction scaffold now matches between zh/en, with learner-facing language selected explicitly. Scores are requested as five components before their sum; this is an instruction, not a guarantee or a relaxed validator.

## Real comparisons (all DeepSeek Flash, thinking disabled)

Each row has the same 28 known operations (12 grammar, 12 vocabulary assessment, 4 generation; both languages). These are development regressions, not new held-out tests.

| Version | Calls | First candidate rejected | Repairs structurally recovered | Final structural success | Final expected assertions | All-call paid estimate USD |
|---|---:|---:|---:|---:|---:|---:|
| v3 | 32 | 4 | 1 | 25/28 | 25/28 | .005744406 |
| v4 | 34 | 6 | 5 | 27/28 | 26/28 | .006465936 |
| v5 | 32 | 4 | 3 | 27/28 | 27/28 | .005351574 |
| v6 (current) | 32 | 4 | 3 | 27/28 | 26/28 | .005291031 |

All 130 requests have complete normalized usage and non-null paid estimates. Historical failed/incorrect outputs are retained. These cost totals reflect measured cache/time bands; v6 repriced at peak and cold cache totals .0169404 USD. First candidate rejection is 4/28=14.29% in v6, distinct from final structural success 96.43% and expected assertion success 92.86%. Automatic assertions are not a full semantic quality certificate.

Current v6 failures: zh missing-target fails exact score-sum validation twice (charged); en `音楽を聞くながら料理をします。` is incorrectly accepted at 100, with an explanation claiming the absent stem `聞き`. The zh counterpart correctly identifies the connection error and scores 58. v5 caught both connection errors but awarded 0 in all dimensions, so even its 27 expected passes do not establish well-calibrated scores. The latest prompt therefore does not qualify this model. A structure-only repair cannot detect every semantic false positive.

The 16 current vocabulary operations pass their expected evidence/generation checks, including requiring Japanese answers in English sessions; this small set does not establish broad vocabulary qualification. Final `results-*`, sanitized `synthetic-raw-*` and `usage-*` files retain both languages, original inputs, full final candidate text and request IDs; join usage.taskKey to `${runId}:${model}:${locale}:${id}`. `repair-report-*` separates first and final outcomes.

## Cost with repairs and rejected attempts retained

v6 known costs divided by final expected passes (all failed calls stay in numerator):

| Purpose | Passed operations | Calls | Observed USD per passed operation | Peak/cold USD per passed operation |
|---|---:|---:|---:|---:|
| Grammar | 10/12 | 13 | .000266901 | .000684330 |
| Vocabulary assessment | 12/12 | 13 | .0001375045 | .000607425 |
| Vocabulary generation | 4/4 | 6 | .00024299175 | .000702000 |

These denominators are provisional expected passes, not independently certified success. A failed operation consumes cost even if no learner feedback is delivered. Provider rejection without usage/network uncertainty elsewhere remains null, never free. The old baseline artifacts and first report remain archival; v6 economics uses only v6 measured calls and does not combine sequential prompt versions as if one runtime policy.

Illustrative peak/cold scenario: 50% grammar, 50% vocabulary, **one generation per vocabulary correction**, with all measured repairs. Annual AI cost is $7.28/$14.55/$43.66/$87.33 at 20/40/120/240 corrections per day. Every model/input/output/thinking/cache price uses the paid-price version in usage, not free tier. All prices, grammar/vocabulary mix, one-third versus one generation, peak/cache, free-user ratio sensitivities are in `economics-bounded-repair-v6.json`.

| Daily corrections | Annual launch $64 contribution | Annual standard $99.99 contribution | Annual JPY6400 contribution | $0.99 day contribution | JPY100 day contribution |
|---|---:|---:|---:|---:|---:|
| 20 | $52.50 | $86.11 | $33.43 | $.9047 | $.6161 |
| 40 | $45.22 | $78.84 | $26.15 | $.8848 | $.5961 |
| 120 | $16.11 | $49.73 | -$2.96 | $.8050 | $.5164 |
| 240 | -$27.55 | $6.06 | -$46.62 | $.6854 | $.3967 |

Contribution here deducts AI and 3.6% Japan card + actual enabled 1% Climate; USD assumes additional 2% FX. JPY/USD150 and CNY/USD7.2 are scenario parameters, not current FX quotes. Fixed cost remains Tencent renewal quote40CNY/month plus conservative Workers standard$5/month ($126.67/year base); Workers actual invoice, domain, backups, excess requests/CPU, taxes/refunds/acquisition remain unverified extras. Annual heavy-user losses occur before these fixed/extra costs. No daily cap is inferred or added.

At launch40/day, peak/cold50% vocabulary and generation1, fixed-cost break-even is 3/4/6/37 annual paying users at free:paid ratios0/1/5/10 under the existing free allowance sensitivity. Standard240/day yields only $6.06 before allocation, requiring21 annual paying users even with zero free users and no unverified extras. Day-ticket break-even entries assume equivalent daily ticket volume continuously throughout the year; they do not mean a one-off buyer pays for a year's hosting.

Sources and pricing semantics remain the paid primary-source snapshot documented in README: [DeepSeek](https://api-docs.deepseek.com/quick_start/pricing/), [Gemini](https://ai.google.dev/gemini-api/docs/pricing), [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Stripe Japan](https://stripe.com/jp/pricing). Static translation $0.06569925 remains one-off, excluded from runtime.

## Reproduce and independent acceptance

Use this worktree's protected authorized .env and isolated database; scripts reject other database URLs and never print keys:

```sh
npx tsx scripts/ai-cost/regression.ts --run --model=deepseek-flash --tag=your-unique-tag
npx tsx scripts/ai-cost/repair-report.ts --tag=your-unique-tag
npx tsx scripts/ai-cost/economics.ts --run-tag=your-unique-tag
```

For independent fixtures call AiReviewService.review / VocabularyAiService, not a provider directly, so the 2-call repair policy is tested. Set a unique usageContext taskKind/taskKey and attempt1, provide the same protected Prisma recorder; never point this harness at production. A 28-operation batch is bounded at56 network calls (grammar service only, without worker retries). Receipt-file mode is a synthetic-only no-DB alternative described in README.

Validation: 402 unit tests, 66 integration tests, build, targeted eslint, line limits and diff whitespace pass. Integration verifies a charged invalid score candidate followed by a valid model response produces two independent durable receipts and exact original model scores. F's earlier12 held-out outcomes remain independent evidence and are not counted in these28 regressions. Further thinking-mode evaluation and new held-out acceptance are pending; no model promotion or sales enablement follows this report.
