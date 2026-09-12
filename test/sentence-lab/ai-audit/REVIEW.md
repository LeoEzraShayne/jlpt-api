# F independent runtime quality and cash-cost pre-review

2026-09-13 JST. Audited D implementation `c32e91eb99c9ce388b13d33084e78bb39e4bacbc`. **Charging/model qualification remains pending.** No production settings, prices or quotas were changed. This review supports an explicit user decision about annual-price risk; it does not authorize a different product plan.

## Independently reproduced economics

`recompute.py` uses only Python standard library and original token records, not D's pricing helper or generated economics table. It fingerprints three initial-cohort input files, deduplicates all 154 request UUIDs, checks total-token algebra and independently computes paid peak/cold-cache rates. It reproduces D's figures. Re-run:

```sh
python3 test/sentence-lab/ai-audit/recompute.py /absolute/path/to/api-ai-cost > /tmp/f-cost-recomputed.json
python3 test/sentence-lab/ai-audit/verify-held-out.py
```

The figures below assume 50% grammar / 50% vocabulary and one new question per vocabulary correction. Grammar, word assessment and question generation all contribute. Known schema-invalid and provisionally rejected semantic outputs are in the numerator. Initial DeepSeek denominators are 10 accepted grammar / 12 calls, 10 accepted vocabulary assessment / 12 calls, and 2 accepted generation / 4 calls; the last denominator is particularly small. Gemini 3.1 has 6 / 8 grammar, 3 / 4 assessment (only Chinese successes; English ended in 429) and 2 / 2 generation. They are provisional model-review denominators, not human certification.

| Successful corrections/day | DS annual AI | 3.1 Lite annual AI | DS daily AI | 3.1 daily AI |
|---:|---:|---:|---:|---:|
|20|$7.2567|$6.5262|$0.019881|$0.017880|
|40|$14.5133|$13.0524|$0.039763|$0.035760|
|120|$43.5400|$39.1572|$0.119288|$0.107280|
|240|$87.0801|$78.3144|$0.238576|$0.214560|

Base FX is a declared scenario: JPY150/USD and CNY7.2/USD, not a current market quote. Card fees are 3.6%, account Climate contribution 1%, plus 2% when USD settlement requires FX. This gives USD launch annual net $59.776, standard annual net $93.39066 and JPY6400 annual net $40.704. [Stripe Japan pricing](https://stripe.com/jp/pricing) confirms the card and conditional currency-conversion fees; Climate is the supplied account assumption.

At 240/day the annual launch price leaves **-$27.3041 DS / -$18.5384 Lite** before infrastructure/free users; JPY annual leaves **-$46.3761 / -$37.6104**. At 120/day JPY annual leaves **-$2.8360 / +$1.5468**. At 240/day USD standard annual leaves only **+$6.3106 / +$15.0763** before those expenses.

Daily passes have the following cash contribution after payment fees and sampled AI, before infrastructure/free users/unknown expenses. JPY-column values are USD equivalents; multiply by 150 to express yen. Net receipts before AI are USD0.92466 and JPY95.4 (=USD0.636).

| Corrections/day | DS USD0.99 pass | DS JPY100 pass | 3.1 USD0.99 pass | 3.1 JPY100 pass |
|---:|---:|---:|---:|---:|
|20|$0.904779|$0.616119|$0.906780|$0.618120|
|40|$0.884897|$0.596237|$0.888900|$0.600240|
|120|$0.805372|$0.516712|$0.817380|$0.528720|
|240|$0.686084|$0.397424|$0.710100|$0.421440|

Thus a daily-only option has positive sampled variable contribution at these four levels, **conditional on a quality-qualified operational route**. This is not evidence of profitability at arbitrary unlimited usage. Fixed costs for daily tickets must be divided by actual sold pass-days, not assume every buyer purchases 365 times. At DS240/day, paying only the $126.67 annual infrastructure base requires at least 185 USD passes or 319 JPY passes, before free-user/other costs.

Infrastructure base is 40 CNY/month Tencent renewal quote plus $5/month Workers = **$126.6667/year** at base FX. The Workers figure is a conservative plan-base assumption, not an audited invoice or an upper bound; request/CPU overages and unverified extras remain unknown. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) documents the base and overages. Fully active free users (five tasks × three successful corrections daily, five generations if all vocabulary) cost about **$4.00696/year DS / $4.09393 Lite** at this 50/50 mix. For example, DS40/day launch annual with ten payers and five such free users per payer leaves $12.56118 per payer after this infrastructure base. This excludes tax, refunds, acquisition and unverified extras; it is cash contribution, not profit.

## What these numbers establish and what they do not

- **Peak/cold-cache is a stress assumption, not expected traffic.** DeepSeek off-peak rates are half of peak rates; the current frozen requests occurred off-peak and often had cache hits. Applying peak rates to all 365 days overstates a normal calendar price mix. The observed annual losses are therefore real *within the disclosed stress scenario*, not proof every heavy user necessarily loses money. [DeepSeek official rates and weekday UTC windows](https://api-docs.deepseek.com/quick_start/pricing/).
- Conversely, unknown billed failures, longer future prompts, retry/fallback attempts and provider price changes can raise costs. A known-cost subtotal is a lower bound **conditional on the scenario rates and cohort**, not a statistical bound on future bills. The initial cohort predates final language/validation changes. The eventual routed implementation, including all rejected attempts, must be measured again.
- The sum-of-known-cost / accepted-output ratio charges observed discarded outputs and approximates repeated work; it is not a measured retry chain or a measured population distribution. Only 2 generated questions determine the DS generation denominator. No year-long activity sample, latency SLO, confidence interval or general JLPT accuracy estimate is supported.
- Gemini's 20-request/day free project quota cannot fund a production plan. The server artifacts contain 2.5 Lite 404s, 3.5 quota failures, and incomplete 3.1 English coverage. Pricing uses standard paid rates; Gemini output includes thinking exactly once as total minus prompt. For example, 3.5 generation input546 + visible196 + thoughts901 is $0.010692, not $0.002583. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing).
- Pricing options may be presented to the user as daily passes first, revised annual prices, or knowingly funded annual subsidies. This review does not select an option, create hidden caps or activate charging.

## Frozen held-out quality evidence

`held-out.ts` contains six previously undisclosed cases in zh/en (12 calls): new verb connection やすい wrong/correct, opposite obligation/prohibition with わけにはいかない, and new vocabulary 予約 versus natural 取っておきました. Fixtures were written only after D's implementation commit was frozen and were not given to D before the run. Credential parsing selects only DEEPSEEK_API_KEY from the explicitly authorized protected file; no source DATABASE_URL is loaded. A random local Postgres database was migrated, used for durable receipts, then dropped. No retries or other provider calls occurred in this particular run.

Run `2026-09-12T16:04:34.467Z`: **12 requests, 12 unique receipts, 11 valid structured feedback responses and one charged rejection**. `held-out-{results,raw,usage}.json` preserves all outputs, including the rejected raw text. `verify-held-out.py` independently joins task keys/request IDs, verifies token counts against raw provider usage and recomputes actual paid estimate **$0.002234844**, all usage complete. It also computes peak/cold for those same 12 calls. The output audit explicitly labels each case as independent F model review, not human linguist certification.

The rejected English wrong-connection case correctly detected 書くやすい → 書きやすい, but total30 disagreed with component sum35. Existing strict validation rejected it. Do not silently adjust arithmetic or reduce the quality threshold. Both locales preserved the opposite meanings: 提出しないわけにはいかない = must submit, whereas 提出するわけにはいかない = cannot submit. Both correctly accepted 予約 and left the natural alternative's target/meaning/reading evidence null without rewriting the sentence.

Two English correct grammar responses claimed scenario completion despite no scenario. These are model instruction deviations. The existing worker persists null unless a matching stored scenario exists, so this run does not show a persisted scenario award bug. Chinese alternative translation 占好 is less idiomatic than 预留/订好 in this context, but the target-evidence decision and broad reservation meaning remain correct.

This held-out sample does not establish general JLPT pass rate. D's earlier final targeted run still had two rejected candidates. A route may qualify with bounded retries if the final accepted feedback is correct, all attempts remain metered, and failures/latency are acceptable. The next review must evaluate that real route; it need not demand perfect first-attempt model output. **Current route qualification is pending.**
