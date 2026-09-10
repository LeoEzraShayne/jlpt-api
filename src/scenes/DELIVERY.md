# Role D delivery

## Changes

- Persist server-owned scene/version/task/objective/register, training mode and chosen source snapshot inside session creation transaction. Early sessions reuse familiar scenarios; later sessions combine expressions and transfer to a different communication objective. Register cues exclude incompatible formal/casual scenes. No matching new scene yields no transfer proof.
- SceneService integrates C selection (<=2 words, <=1 learned N2–N4 support grammar, private expressions/phrases); optional content failures retain base training. Exposure and usage are idempotent, limited to selected/observed content and never write grades/progress/events.
- Review get/create/complete responses redact expression/phrase text and grammar references, even after an earlier reveal. Explicit reveal commits B's hint transaction before returning references. Submission acquires user/session locks and uses the persisted task rather than client-provided scene text.
- Four-part AI response with separate diversity advice; simple accurate sentences can score 100. Prompt/schema/Gemini structured schema updated together; provider selection honors optional AI_PRIMARY_PROVIDER with legacy default Gemini. Invalid supplements preserve valid correction and discard scenario proof. Invalid core correction/score/furigana/translation remains a failure.
- Worker loads the session snapshot, stores new AI fields, never creates scene proof from absent/mismatched context, and preserves completed jobs when optional exposure recording fails.

## Integration

- API contract: `src/scenes/CONTRACT.md` (already provided to main/E).
- StudySessionsModule and SentenceReviewsModule now import SceneModule; SceneModule imports ContentModule. No extra AppModule wiring necessary beyond existing modules.
- Schema/config/migrations/B evidence-completion and activity ledger unchanged. Requires main's existing TrainingScenario/session/result fields, seeded scenes and ContentModule models.
- Complete evidence remains governed by B's learningV2Enabled switch; scenario assignment can run regardless of the switch. No historical scenario metadata is fabricated.
- New session IDs are UUIDs to allow deterministic source rotation before creation. Existing IDs and API string conventions remain supported.

## Validation

- All 154 Jest tests passed (28 suites), including new provider/scenario/worker/privacy regressions.
- TypeScript noEmit passed.
- Nest build passed.
- Scoped ESLint passed.
- 500-line check passed (129 TypeScript files).

## Remaining integrated verification

- Main/F must exercise migrated PostgreSQL, concurrent real HTTP sessions, front-end explicit reveal merging and full B cross-date mastery chain.
- Main runs the small real DeepSeek/Gemini check using its local configuration; no secrets were copied into this worktree and production settings were untouched.
- Scenario appropriateness and meaning/translation correctness rely on AI evaluation plus follow-up human sampling. Register filtering and distinct-objective selection are deterministic; they do not imply every grammar naturally fits every scenario. The prompt abstains from scene success if the target cannot naturally complete the task.
- Vocabulary usage detection is conservative exact selected surface matching; inflected forms may be undercounted. Usage is only observational, never mastery credit.
- Invalid optional output can produce null four-part extensions or reuse the correction as the alternative. UI must retain the existing correction panel in that case.
