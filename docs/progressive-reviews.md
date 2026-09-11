# Focused AI corrections (2026-09-11)

New reviews generate only grading, target-grammar correctness, detailed error spans (original text, replacement and Chinese reason), a corrected sentence with readings and Chinese translation, a concise explanation, and server-scene completion evidence. Automatic content responses, extension examples, diversity advice and next practice are not requested or saved. Core results complete the existing job and immediately permit recall. The provider priority remains unchanged.

The UI retains the “需要调整的地方” card and core feedback. It removes expression-variation advice, next-practice cards and the expression-bookmark form, including in historical detail. Existing saved expressions and historical examples remain readable. No existing learning records or expression records are deleted.

Workers claim rows atomically with SKIP LOCKED and UTC millisecond timestamps. Expired two-minute leases recover interrupted jobs; conditional transaction guards fence late responses from an old lease. Legacy non-UTC future locks are reclaimable on upgrade. Requests have a 20-second deadline covering headers and body, including each fallback provider. There is no background extension worker or additional extension call.

No production database migration is required: existing nullable extension-content columns already support core-only results. Deploy the API followed by the frontend. Rollback uses the previous API and frontend releases without altering records. The abandoned, never-published extension-queue migration is absent from the final release.

Validation covers usable core-only API results, recall completion, account isolation, concurrent workers, interrupted-job recovery/fencing and non-UTC database clocks. Desktop/mobile E2E verifies specific correction details, no auxiliary cards or bookmark form, completion and historical examples. Browser plugin unavailable; existing Playwright was used. `scripts/smoke-progressive-ai.ts --run` compares synthetic core/full requests and verifies a deliberately incorrect grammar case still has detailed corrections; it does not write learning records.

Observe time to feedback (result.createdAt - job.createdAt), provider latencyMs and input/output tokens. Smaller outputs should reduce waiting and token cost, but a single smoke run cannot guarantee future latency or language quality.
