# F independent spaced Gemini batch

**Seven delivered outputs pass the bounded core semantic review; one operation correctly fails closed. Gemini generation remains unverified in both languages.** The real server run used the same frozen model/prompt settings and candidate `55f1763+runner-c3d941d`, started `2026-09-12T23:25:24.633Z`. Each of eight explicitly selected cases ran once. The runner waited at least 65 seconds and respected the disposable database's natural circuit cooldown; it did not clear a circuit or request extra attempts until success.

There are **8 operations, 12 requests and 12 unique receipts**. All eight operations reached Gemini once: the first four received HTTP 503, the last four returned valid content. DeepSeek was called four times after the 503s: three succeeded; the English connection-error fallback returned a Chinese translation and was correctly rejected as `AI_LOCALE_MISMATCH`. That operation has no accepted final output and no third request. The raw wrong-language candidate and its charged receipt remain present. This isolated-service run does not execute an additional worker round; existing independent tests cover the bounded worker retry mechanism, and we do not relabel this failed operation a successful live recovery.

All available raw token values agree with the ledger. Four HTTP 503 receipts have unknown usage/null cost. Known tokens, including the rejected DeepSeek output, repriced as paid DeepSeek peak/cold cost **$0.005019**, plus four unknown-usage calls. Combined with batch 1: **20 operations, 26 requests/receipts, $0.0148686 known DeepSeek-basis cost plus five unknown-usage calls**. Do not extrapolate this small sample into a production success percentile or annual budget.

## Independent reading

The four actual Gemini contents passed the frozen core judgments:

- English natural synonym: the Japanese sentence is unchanged and natural, target/meaning/reading evidence remains unverified rather than manufactured from the exercise reference.
- Chinese wrong sense: 予約 is correctly rejected as drinking; 飲み干しました preserves thirst and finishing the glass in one go, with accurate reading and translation. This acceptable alternative need not exactly equal the example 飲みました.
- English wrong sense: the original target use remains false and the corrected sentence means drinking the water in one gulp; explanation, reading and translation agree.
- English no-obligation grammar: the natural Japanese is unchanged and correct; the translation means printing is unnecessary, without changing the sentence to prohibition or inability.

The three successful DeepSeek fallbacks (Chinese/English generation, Chinese synonym) also preserve the requested target sense, selected explanation language and appropriate evidence; readings and translations match. Raw furigana separator spaces in one Gemini response were normalized away by the existing schema, and the final reading reproduces the sentence exactly. No raw score or input fixture was modified by F.

## Combined actual Gemini coverage

| Purpose / locale | Chinese | English |
|---|---|---|
| Grammar review | Connection-error diagnosis, batch 1 | No-obligation/natural sentence, spaced batch |
| Vocabulary assessment | Wrong-sense rejection | Natural-synonym abstention and wrong-sense rejection |
| Vocabulary generation | **No content: HTTP 503 only** | **No content: HTTP 503 only** |

Across both batches Gemini has ten requests: five content successes and five HTTP 503s. The minimum remaining purpose/locale matrix is exactly **zh:generate and en:generate**. Each has had only one actual Gemini attempt, which was unavailable rather than a bad language answer. Main may run one bounded follow-up for those two frozen cases with unchanged configuration and natural spacing. No provider calls were made by F, no infinite success-seeking rerun is proposed, and the currently missing evidence must not be called a pass.

More extensive case-by-case Gemini coverage would additionally need the untouched natural controls, Chinese no-obligation, Chinese synonym and English connection-error cases. The six-cell purpose/locale matrix is only a bounded launch check, not comprehensive multilingual accuracy.
