# F independent frozen mixed-candidate acceptance — 2026-09-13

Candidate: D `1acb110` + `3e71d71`, parent lease fix `0bf99ed`, environment validation `467741a`, card quote policy `dae88f4`. F's isolated worktree contains these commits. **The candidate passed this bounded batch's core semantic and structural checks; one explanation wording defect remains visible. This is limited positive quality evidence, not a JLPT-wide accuracy claim or permission to activate billing.** Economics remains a business decision.

**F quality-gate conclusion: PASS for this frozen candidate's bounded independent batch.** The one diagnostic wording advisory is **non-blocking for feature publication with sales/enforcement disabled**: the target-usage decision, correction, translation, reading and memory-evidence flags remain correct, and the detailed correction reason supplies the right explanation. Track the imprecise clause as a quality-improvement item; do not call the feedback flawless. This conclusion does not claim comprehensive JLPT accuracy or override the main agent's deployment checks. **The commercial-release gate remains pending the user's pricing/subsidy decision**; this quality result does not authorize charging.

## Scope, provenance and integrity

The first 12 zh/en cases were frozen in F commit `824fc8e`, before the mixed candidate. An additional 12 operations on four unseen words were written and hashed before any call. D did not receive these fixtures before the run. `mixed-manifest.json` pins both input files; prior F and D failures were retained. The new run `2026-09-12T16:39:38.356Z` invoked the actual AiReviewService/VocabularyAiService routes in a fresh local PostgreSQL database, not one-shot providers. Only the explicitly authorized DEEPSEEK_API_KEY was parsed from the protected D file; its database URL was never loaded. No browser, production, default model or charging configuration was changed.

Actual settings were DeepSeek Flash, low thinking for GRAMMAR_REVIEW only, explicit disabled thinking for vocabulary, Gemini unconfigured. Grammar requests had a 4096-output-token cap. Captured request metadata verifies the purpose-specific setting and that each grammar/assessment request, including repairs, retained the original answer. Thinking content is not stored in the raw evidence; final candidate text and numeric usage are retained.

**24 operations / 27 requests / 27 unique PostgreSQL receipts**, within the authorized 24 / 48 limits. No extra worker round was invoked. The database was dropped after receipt export. `audit-mixed.py` independently joins operation/attempt/request IDs, checks raw versus normalized usage, verifies fixture hashes and recomputes prices without D helpers.

## Quality and latency

All 24 final operations passed their frozen structural/evidence assertions. F independently read each final Japanese sentence, furigana, translation, explanation, correction and target-evidence flag. Both grammar connection errors remained incorrect after repair; natural controls remained correct; obligation versus no obligation retained the correct opposite meanings. Natural synonymous vocabulary answers remained unchanged and did not manufacture target or pronunciation evidence. Wrong word meanings were rejected, and corrections preserved the plausible original intent without forcing the target back into the sentence. Four new generated questions used natural Japanese targets, concealed target spelling/readings in prompts/hints, and had matching readings/translations.

Three first candidates were correctly rejected and subsequently repaired:

| Operation | First rejection | Second candidate |
|---|---|---|
|English connection error|Translation was Chinese; `AI_LOCALE_MISMATCH`|English translation and correct original-error diagnosis|
|Chinese savings generation|Phrase chunks contained reading brackets; `AI_INVALID_RESPONSE`|Plain chunks reconstruct the reference|
|English entrust wrong meaning|Correction reason was Japanese; `AI_INVALID_RESPONSE`|English explanation/reason; original word still correctly rejected|

These rejected responses are charged, retained and excluded as usable feedback. No score was altered by F and no acceptance threshold was relaxed.

**One advisory remains:** in zh:saving-wrong, the model correctly rejects using 貯金 as “eat” and correctly replaces it with 食べました, but one explanatory clause says 貯金 cannot be the object of eating. In the actual original, 貯金 is the predicate. This appears to transfer wording from a different prompt example. It is an explanation defect, not false target success; the detailed correction reason is accurate. The audit marks this case explicitly rather than calling the feedback perfect. Review method is an independent F model reading, not human linguist certification.

Observed end-to-end latency includes repair: grammar median **6.337 s**, nearest-rank p95/max **15.967 s** (only 8 operations); vocabulary assessment median **1.498 s**, max **3.831 s** (12); generation median **1.799 s**, max **3.447 s** (4). These small-sample values are not production percentiles or an SLA.

## Independent paid-cost recomputation

All 27 requests have complete usage. Total paid estimate at the observed Saturday off-peak/cache state is **$0.011798346**; peak/cold repricing of the exact same calls is **$0.0290157**. Grammar included **11,795 reasoning tokens**, already inside DeepSeek completion tokens and therefore charged exactly once. No free Gemini allowance or zero-cost failed call is assumed. Price and fee sources, FX assumptions and limitations are in the prior F REVIEW.md; rates are unchanged.

| Purpose | Requests / final operations | Rejected candidates | F peak/cold cost per final operation | Independently recomputed D historical value |
|---|---:|---:|---:|---:|
|Grammar thinking|9 / 8|1|$0.0024039375|$0.0032788091|
|Vocabulary assessment|13 / 12|1|$0.000633775|$0.000607425|
|Vocabulary generation|5 / 4|1|$0.000544725|$0.000702000|

Historical values are recomputed from the full relevant D receipts, including rejected attempts, divided by D's declared final accepted-output count (grammar 11/12 operations, 14 calls). They are not relabelled as a new F semantic certification. Historical grammar costs are materially higher; the favorable new batch must not replace them silently.

For 50% vocabulary and one generation per vocabulary correction, the **new F sample** implies:

| Corrections/day | Annual AI | USD64 annual contribution | JPY6400 annual contribution | USD0.99 day contribution | JPY100 day contribution (USD equivalent) |
|---:|---:|---:|---:|---:|---:|
|20|$13.0759|$46.7001|$27.6281|$0.888836|$0.600176|
|40|$26.1518|$33.6242|$14.5522|$0.853011|$0.564351|
|120|$78.4554|-$18.6794|-$37.7514|$0.709714|$0.421054|
|240|$156.9108|-$97.1348|-$116.2068|$0.494768|$0.206108|

All contributions deduct card 3.6%, Climate 1%, and conditional USD FX 2%, using JPY150/USD, CNY7.2/USD scenario rates. They exclude fixed/free/unknown expenses. At 240/day the USD99.99 annual also leaves **-$63.5201**. Even reusing each generated vocabulary question three times lowers 240/day annual AI only to **$141.0048**. JSON includes 20/40/120/240, 0/50/100% vocabulary and both generation ratios.

**JPY100 heavy-grammar day passes remain at risk.** At 240/day, 100% grammar costs $0.576945 in the new F mean, leaving just **$0.059055 (JPY8.858)**. The historical grammar mean costs $0.786914, leaving **-$0.150914 (JPY-22.637)**. The highest observed F grammar operation costs $0.0048147 at peak/cold; repeating similarly expensive work 240 times would cost $1.155528, losing **$0.519528 on JPY100** and **$0.230868 on USD0.99**, before fixed/free costs. That repetition is a sensitivity scenario, not a forecast, but demonstrates why neither a favorable 50% mix nor the latest mean guarantees coverage of unlimited use.

Fixed infrastructure base remains **$126.6667/year** (Tencent40CNY/month plus assumed Workers$5/month). At the new F 50/50 mix, one fully active free user costs **$8.81280/year**; grammar-only free usage costs **$13.16156/year**. For example, F40/day launch annual with ten payers and five fully active free users per payer already has negative contribution after these costs. Taxes, refunds, acquisition, request/CPU overages and other unverified costs are unknown, not zero. Actual peak-time share/cache behavior can lower costs; longer prompts, failed attempts and usage concentration can raise them. The synthetic batches do not establish an annual user distribution.

## Recovery, quota and remaining decision

The independent seven-case repair suite now passes against the parent lease fix: normal worker failures and crash recovery use no more than six automatic calls. Two additional independent real-Postgres tests verify six concurrent manual-retry requests admit exactly one final two-call round (receipt ordinals7/8), release the pending quota after failure, and cannot admit a fifth round. They also overlap an old paused claimant with a newer result: the old ordinal remains1, the new one3; the late old result cannot replace the new score, create a second result or consume quota twice. Explicit manual recovery is preserved; the total per-job bound is eight, distinct from the six-call automatic bound.

This batch supports the scoped candidate's core teaching behavior with one documented wording advisory. It does not resolve the annual-price losses or guarantee daily-price profitability. No hidden member cap, price change, model switch or live sale was applied. The main agent/user must make the concrete pricing/subsidy/release decision with these limits visible.
