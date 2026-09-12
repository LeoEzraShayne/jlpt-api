# F final bounded Web launch / Gemini free-first acceptance

**F recommendation: the frozen Gemini free-first route is suitable for this bounded Web launch, with the existing DeepSeek fallback and all current validation, metering and call limits retained.** This recommendation is based on real server output in all six purpose/language cells and independent operational PostgreSQL tests. It is not a claim that all JLPT material, every error type or all future calls are correct or available. Main must complete the separate live Stripe configuration/readiness and guarded production deployment; F does not claim those platform actions were performed here.

AI candidate: D `05c0179`, integrated server candidate `55f1763`; runner initial `d8b1a7a`, then bounded subset/spacing `c3d941d`. The model remains **gemini-3.8-flash with low thinking**, followed by **deepseek-flash with low thinking for grammar and disabled thinking for vocabulary**. No prompt, language validator, score threshold or input fixture was weakened between real batches. The main agent reported that the server key matches the intended Google project and the project is on the free tier; F did not access the key or console.

## Actual Gemini coverage

| Purpose | Chinese successful evidence | English successful evidence |
|---|---|---|
| Grammar correction | Rejects 書くやすい, corrects to 書きやすい, diagnoses original stem error | Natural no-obligation sentence remains correct, unchanged, and means no need to print |
| Vocabulary assessment | Rejects booking as drinking and correctly produces 飲み干しました | Natural synonym yields no manufactured target evidence; wrong booking/drinking meaning is rejected |
| Vocabulary generation | Natural suggestion to telephone a restaurant and reserve seats; target, reading, translation and chunks agree | Natural polite request to book tomorrow evening; target, reading, translation and chunks agree |

The last two generated references were read independently by F after their raw responses arrived. The Chinese prompt asks the learner to make a suggestion, and the reference naturally uses 予約したほうがいい. The English prompt requests a polite reservation and the reference naturally uses 予約をお願いしたいのですが. Neither prompt or hint leaks Japanese target spelling or reading; all reference readings/translations are accurate and chunks reconstruct the references ignoring punctuation. The English prompt does not explicitly repeat “in Japanese”, but does not request an English answer; its reference and the exercise flow remain Japanese sentence production. Each matrix cell contains a small number of samples, including only one vocabulary target sense; this does not establish comprehensive language coverage.

## Complete outcomes and cost

| Batch | Operations | Network calls / receipts | Actual Gemini contents | Accepted final outputs | Unknown-usage calls | Known cost at DeepSeek peak/cold basis |
|---|---:|---:|---:|---:|---:|---:|
| Initial mixed run | 12 | 14 | 1 | 12 | 1 | $0.0098496 |
| Spaced missing-coverage subset | 8 | 12 | 4 | 7 | 4 | $0.0050190 |
| Final generation subset | 2 | 2 | 2 | 2 | 0 | $0.0007212 |
| **Total** | **22** | **28** | **7** | **21** | **5** | **$0.0155898 plus unknown usage** |

Gemini had 12 calls: seven accepted contents and five HTTP 503 responses. DeepSeek had 16 calls: 14 accepted contents and two correctly rejected candidates (ruby annotations in phrase chunks; Chinese translation in an English grammar answer). The English connection-error operation in the spaced subset had Gemini 503 followed by the wrong-language DeepSeek candidate, so that isolated two-call round correctly failed closed. It did not obtain a third call, accepted output or successful-task consumption. No live worker recovery for that exact failed operation is claimed. Independent real-worker tests cover bounded automatic/manual recovery and non-duplication separately.

Every actual request has a unique durable PostgreSQL receipt. All available raw token counts agree with normalized input/output/thinking/total; discarded candidates are included and thinking is charged once. The five HTTP 503 calls have null cost/unknown usage, not fabricated zero. Costs above reprice all known Gemini and DeepSeek tokens on the approved paid DeepSeek peak/cold basis without subtracting free quota. These small batches neither replace the established annual-cost ranges nor predict a population success rate.

## Known limitations retained

The raw scenario-success flag from one DeepSeek natural control is wrong because no server scenario exists. F retained the mechanical audit failure and independently proved with the actual provider/worker and PostgreSQL that missing server context/ID forces the persisted value to null. Existing downstream evidence guards further prevent it from becoming scenario-memory proof. Two DeepSeek vocabulary explanation clauses are imprecise (predicate/object confusion and an overbroad claim about reserving water), while target failure, corrected drinking meaning and readings remain correct. These are documented diagnostic advisories in REVIEW-RUN1.md; feedback is not labelled flawless.

The spaced and final subsets used an explicit bounded list, each case once per selected batch, unchanged settings, at least 65 seconds between operations and natural disposable-database cooldown. No production gate was cleared. A repeated case after HTTP unavailability was recorded as a later explicit batch, not silently replacing an earlier failure. All three raw/results/usage sets and original mechanical outputs are preserved; `evidence-sha256.json` pins them. The mechanical audit scripts intentionally do not claim semantic approval; this independent reading provides the scoped semantic conclusion.

## Deployment-relevant operational acceptance

F's final full independent real-PostgreSQL run passed **70 tests in 13 suites**, and TypeScript/diff checks passed. D's four real-PG circuit tests also passed when independently rerun. The suite covers fixed global USD prices and 90-day quote boundaries, Stripe event/legacy snapshot/stale-link behavior, membership renewal/refund/environment isolation, free-task and successful-correction limits, unlimited member access, failure recovery and duplicate evidence prevention. Added tests directly verify the actual activation function: eight concurrent first activations yield one immutable pair of timestamps and one 365-day gift; repeats retain them; missing owner/future/conflicting state rolls back. Main repaired the independently reproduced singleton-upsert race and advisory-lock result-type error before the final green run (`28fc6c8` + `a2adf60`).

Independent actual-service tests additionally prove grammar/vocabulary share Gemini's persistent lease, a busy/cooling Gemini routes directly to DeepSeek, 429 plus successful fallback creates two receipts but only one successful correction/one task consumption, repeated polling cannot consume twice, and untrusted raw scenario success cannot be persisted without trusted context. D's four real-PG circuit tests were rerun independently. These deterministic transport tests certify routing/accounting behavior, not model language quality; the latter comes from the real batches above.

For production, retain the opt-in free-first flag, durable shared circuit, qualified DeepSeek credentials/settings, fail-closed language/schema checks, complete receipts and existing six-automatic/eight-with-manual per-job network bound. These are recovery bounds, never daily membership caps. Web rewards remain disabled. Run the tested atomic activation only after main's live Stripe and paired-service checks; record the real immutable launch/gift timestamps at that point. No additional user pricing approval is required by this review.
