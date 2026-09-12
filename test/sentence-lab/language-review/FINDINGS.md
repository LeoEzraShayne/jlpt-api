# Independent static-language review — F, 2026-09-13

**Language acceptance is not passed.** F inspected 62 actual source/translation records: 24 grammar explanations and connection rules (6 N1, 6 N2, 8 N3, 4 N4), their 24 Japanese examples, all 6 relation groups, and 8 scenarios covering formal/polite/casual contexts. Results: **57 PASS, 1 ADVISORY, 4 FAIL**. This was an independent Codex model judgment, separate from C's DeepSeek translation/review passes. It was not performed by a human Japanese-language specialist and is not certification of the other 484 records.

`static-en-review.json` contains every inspected source, artifact hash, judgment and rationale. Sampling was purposive to stress negation, inflection and register, not random; the observed error rate must not be extrapolated to the full corpus. The earlier 546/546 structural/hash/import pass remains valid and does not imply correct Japanese teaching content.

## F-L01 — incorrect godan connection to まい

Grammar `cmsldfdu70047y1vb3tqhdqss`, **～ようか～まいか**, `connectionRule`.

The original Chinese says godan verbs use an あ-row ending before まい; the English repeats this. This would teach forms such as _行かまい_. Godan verbs take the nonpast/dictionary form, e.g. 行くまい. The rule also contradicts the first clause of its own connection field, which already says dictionary form. The [Shogakukan Digital Daijisen entry on まい](https://kotobank.jp/word/%E3%81%BE%E3%81%84-632809) explicitly gives the terminal-form connection for godan verbs; the [NHK language research report](https://www.jstage.jst.go.jp/article/bunken/68/12/68_46/_pdf/-char/en) discusses the same pattern and variation for other verb classes.

Requested remediation: correct the source connection rule and English, including consistent ichidan/する/来る variants. Preserve meaning and provenance; issue a new source hash and reviewed translation. F will check a godan example such as 行こうか行くまいか.

## F-L02 — にしても alternatives incorrectly restricted to ta-form

Grammar `cmsldfe3x007ly1vb0jpatf6r`, **～にしても～にしても**, `connectionRule`; example `cmsldfe3y007my1vbi2db1058`.

Both Chinese and English list only verb ta-form. Its own correct reference is 行くにしても行かないにしても, showing nonpast affirmative/negative alternatives. This is a source rule defect, not an English mistranslation. The [original teacher explanation with conjugation examples](https://jn1et.com/nisiro-nisiro/) lists plain forms and illustrates affirmative/negative alternatives.

Requested remediation: teach the applicable plain forms and properly distinguish na-adjective/noun handling. The existing Japanese example and its translation are aligned and need not be replaced.

## F-L03 — double-negative Japanese example translated with opposite meaning

Example `cmsldfe5j008qy1vbndypnc0i`, grammar `cmsldfe5i008py1vbbm1gv6pq`, **～ないわけにはいかない**.

Original Japanese: `上司に頼まれたので、断らないわけにはいかない。`

Chinese: `上司拜托了，所以不能拒绝。`

English: `My boss asked me, so I can't refuse.`

The Japanese says one **must refuse**, while both translations say one **cannot refuse**. This is a high-priority teaching error. It also makes the boss-request premise odd. The grammar explanation itself correctly describes obligation. The two negatives in Vない + わけにはいかない make the action obligatory, as illustrated in this [original teaching entry contrasting the two forms](https://passjapanese.com/en/grammar/n2/n2-wake-ni-wa-ikanai).

Recommended source correction for C/main to review: `上司に頼まれたので、引き受けないわけにはいかない。` / `上司拜托了，所以不能不接受。` / `My boss asked me, so I have to accept.` This preserves the intended obligation lesson and produces a coherent context. F has not changed the source. An alternative is to preserve the old Japanese and correct the translation to “have to refuse,” but that leaves an awkward teaching context.

## F-L04 — opposite nai-form meaning omitted from base explanation

Grammar `cmsldfe5g008ny1vb9x5ctek9`, **～わけにはいかない**, explanation and connection rule.

Both dictionary-form and nai-form connections are listed, but the explanation says only cannot do because of responsibility/social norms. The nai-form instead means cannot **not** do / must do, covered separately by the adjacent entry. The existing example uses progressive 遊んでいる, so connection wording should also accommodate the actual example. This is an inherited source presentation defect.

Requested remediation: either clearly explain both affirmative/nonpast and negative obligation branches, or limit this entry's connection and point to the separate negative entry. Do not suggest the two have identical polarity.

## Advisory — relation comparison loses がてら incidental nuance

Relation `cmsldfebb00chy1vbj2a7u66m`, **～がてら／～かたわら／～かたがた**.

The English says がてら means “do B while doing A,” which is broadly understandable but weakens the explicit source distinction “顺便” when contrasted with long-term simultaneous activities. Suggested wording: “take the opportunity to do B while doing A.” The standalone grammar/example are clearer; this advisory is not a separate blocking defect.

## Other inspected strata

The inspected explanations/examples preserve the distinctions between partial negation, impossibility, not necessarily, prerequisite negation, purpose versus prior-action 上で, and polite negative copulas. Animate/inanimate examples retain correct Japanese and reference meanings. Formal visit/purpose language and praise versus criticism contrasts are retained. The eight scenario prompts preserve interlocutors, objectives and register. Full reviewed text and individual decisions are in the JSON artifact.

Main has been informed and will assign C/source corrections before production. Re-import tests must use the corrected public snapshot and newly reviewed hashes; do not relax stale-source validation to make an old artifact pass.
