# Grammar-thinking / vocabulary-disabled candidate

Status: frozen routing implementation for independent testing, not a qualified release. No prompt/validator/default model changes. Configure `DEEPSEEK_MODEL=deepseek-flash`, `DEEPSEEK_THINKING_EFFORT=low`, `DEEPSEEK_THINKING_SCOPE=grammar` in the synthetic ConfigService. The meter enables thinking only for purpose `GRAMMAR_REVIEW`; `VOCABULARY_GENERATE` and `VOCABULARY_ASSESS` remain explicitly disabled. Two network calls per service operation, including any repair, remain the limit. Main owns environment schema and crash-safe worker budgets.

The historical cost composition is reproducible with `npx tsx scripts/ai-cost/economics.ts --mixed`; `economics-mixed-history-v1.json` selects **all grammar calls** from thinking-low-v1 and **all vocabulary calls** from bounded-repair-v6, including rejected/repair calls. It joins final result IDs exactly, not just provider-success rows. This is a projection from separate batches, not a new mixed-run receipt or held-out result. It retains the known grammar furigana failure and cannot establish availability/quality.

Peak/cold paid cost per final expected success: grammar $.003278809; vocabulary assessment $.000607425; generation $.000702000. With 50% vocabulary and one generation per vocabulary correction:

| Daily corrections | Annual AI cost | $64 annual contribution | $99.99 annual contribution | JPY6400 annual contribution | $.99 day contribution | JPY100 day contribution |
|---|---:|---:|---:|---:|---:|---:|
| 20 | $16.75 | $43.03 | $76.64 | $23.96 | $.8788 | $.5901 |
| 40 | $33.49 | $26.28 | $59.90 | $7.21 | $.8329 | $.5442 |
| 120 | $100.48 | -$40.71 | -$7.09 | -$59.78 | $.6494 | $.3607 |
| 240 | $200.96 | -$141.19 | -$107.57 | -$160.26 | $.3741 | $.0854 |

Payment deductions, FX scenarios, fixed Tencent40CNY/month + Workers$5/month, free-user subsidies and unverified extras are unchanged from THINKING_ACCEPTANCE. Positive contributions above still exclude allocation and extras. **Day-ticket support remains usage-mix dependent**: at240/day with100% grammar, measured unit economics imply AI $.786914/day; USD contribution $.137746 but JPY contribution **-$.150914**, before fixed/free costs. Do not approve JPY100 based only on the favorable50% mix. No behavior split/reuse is promised or enforced. All20/40/120/240, mix0/.5/1, cache/time and generation-reuse scenarios are in the JSON. Heavy annual still loses across listed prices and remains a user decision.

Next independent batch is limited to24 operations/48 network calls and should include new unseen vocabulary, both languages and correct/wrong/natural-alternative evidence. F keeps held-out fixtures private and calls the service layer with the scoped ConfigService and a unique metered taskKey. This candidate does not request reading F's fixtures, activating production or changing defaults. Full worker retries, if later tested, must retain every receipt and cost; these historical service batches do not imply a third round is free.
