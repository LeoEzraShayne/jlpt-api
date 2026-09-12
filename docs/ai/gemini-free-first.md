# Gemini free-first candidate (2026-09-13)

Candidate model: `gemini-3.8-flash`. Status: implementation ready for independent acceptance; the main-owned protected-server preflight returned503, so availability/quality are not yet qualified. No production/key/billing-console operation was performed by D. Root/F own the independent real run. The already accepted DeepSeek Flash low-thinking grammar / non-thinking vocabulary policy is unchanged.

## Opt-in behavior

Shared schema/env prerequisite is main commit93e480c. `GEMINI_FREE_FIRST` defaultsfalse. When true (boolean or literal string `true`), both grammar and vocabulary ignore the normal primary ordering: acquire the shared free-provider gate, try one Gemini candidate, then use DeepSeek on an eligible failure. A configured DeepSeek fallback is mandatory. Set `GEMINI_MODEL=gemini-3.8-flash` only when this candidate is accepted; the implementation does not replace model defaults. Omitted/false flag preserves existing provider ordering and repair behavior. Missing Gemini key or unavailable circuit persistence sends work directly to DeepSeek.

A single service round still has at most2 network calls: Gemini success uses1; Gemini failure + DeepSeek uses2 and cannot add another repair. A blocked/busy Gemini does not consume a slot: DeepSeek may use its existing single repair. Main's worker lifecycle budget remains3 automatic rounds plus one explicit manual recovery, maximum8 calls; no new member limits or quota transactions are introduced.

Eligible Gemini failures: HTTP400/401/403/404/408/429/5xx, network/timeout, and strict schema/language/target/evidence validation errors. A400/404 is not repeatedly tried within the operation. A metering failure, non-provider programming error or missing qualified fallback fails closed. No Gemini correction is copied into DeepSeek input; DeepSeek judges the exact original using its accepted prompt and thinking scope.

## Shared circuit

`AiProviderCircuit.key` combines a SHA256 fingerprint of the configured API key and exact model; plaintext keys never enter database/logs. Grammar review, vocabulary assessment and vocabulary generation share the same row. Google quota applies per project; this backend's single configured key is the scope identifier, not a claim that rotating keys creates more quota. There is no key/model rotation.

An atomic UPDATE acquires a30-second lease; one candidate holds the active lease, other concurrent operations immediately use DeepSeek. No transaction remains open during network I/O. Existing network deadline is20 seconds including response body. Expired leases recover after crashes. Completion is fenced by leaseToken so an old holder cannot clear a newer lease/cooldown. SQL timestamps explicitly use UTC to match Prisma timestamp-without-time-zone storage regardless of database session timezone.

Cooldowns after Gemini failure:

| Condition | Cooldown |
|---|---|
| Structured quotaId contains PerDay | Next midnight America/Los_Angeles, including DST |
| Other429 | Structured RetryInfo delay, at least60s and at most24h; absent hint60s |
| HTTP401/403/404 | 24h |
| Network/timeout/5xx | 60s |
| Quality validation or other eligible request error | 5min |

A bare429 message is not treated as daily exhaustion. Daily quota takes precedence over a shorter RetryInfo. Only numeric duration/quota category enters the internal error hint; response bodies, messages, credentials and Google consumer metadata are not persisted. Database release failures leave a bounded lease and do not repeat the completed request. Shared rows persist across service/process restarts. Config/key/model changes use a different identity; ordinary tests never clear production gate state.

## Accounting and qualification

Every attempted provider request first persists AI_IN_FLIGHT, then stores the independent result/error, token counts and paid-price estimate before fallback. Quality-rejected responses retain actual usage;403/429/network failures without usage retain null cost, never fabricated zero. A gate skip produces no provider usage row because no provider request occurred. Failed candidates do not execute successful review/quota transactions.

Gemini3.8 paid estimates use standard published text rates: input/output .75/3.75 USD/M through2026-12-31 and1.5/7.5 afterward, with explicit pricing versionv2; output includes thinking exactly once. Missing unknown counters remain null. These estimates audit provider usage even if the actual account is free. Member economics remain budgeted using DeepSeek, with **no free-tier/promotion credit**. API requests cannot guarantee an account's billing tier: main must keep the project at its confirmed free tier; no paid-tier activation is part of this change.

Official sources rechecked: [stable model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [free/paid availability and prices](https://ai.google.dev/gemini-api/docs/pricing#gemini-3.8-flash), [project limits and Pacific resets](https://ai.google.dev/gemini-api/docs/rate-limits). Current numeric RPM/RPD are account-specific in AI Studio, not a hardcoded20 allowance. The known old2.5 endpoint404 is not used as a candidate.

Independent F runner freezes12 new cases and records first-provider/fallback outcomes separately. It must inject real isolated Prisma as AiReviewService constructor argument4 (VocabularyAiService already takes Prisma argument2). No production database is permitted. A circuit skip or DS fallback is a useful routing result, **not proof that Gemini answered that held-out case correctly**. Quota/503/quality cooldown may make a12-case run mostly DS; report actual provider coverage rather than changing thresholds or clearing production cooldowns.

Local verification covers strict2-call policy,429/404/403/network/quality fallback, metering failure abort, DS-only repairs during cooldown, credential fingerprints, Pacific DST23/25-hour days, independent-instance racing CAS, stale completion fencing, charged quality rejection and unknown-cost429 followed by DS. No score/reading/evidence validator was weakened. Current real-model qualification remains pending.
