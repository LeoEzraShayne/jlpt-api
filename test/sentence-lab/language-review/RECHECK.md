# F independent source correction recheck — 2026-09-13

C commit `8b5cc2d5386e468e9ddfab47531b7e1345a6357b` independently reviewed. **F-L01–F-L04 and the がてら advisory are closed for this reviewed revision.** Historical FINDINGS.md and static-en-review.json remain unchanged; this is not a claim that every corpus sentence has expert review.

The five edited English entries were read alongside the original Japanese/Chinese and the exact correction artifact. Godan まい now uses dictionary form, and ichidan/irregular variants are separated; paired にしても no longer incorrectly excludes nonpast/negative forms. The obligation example now says 引き受けないわけにはいかない / 不能不接受 / have to accept, consistently positive obligation. The affirmative わけにはいかない entry now explicitly distinguishes the negative obligation branch and includes its existing Vている example. がてら now retains incidental opportunity. Original teaching evidence for the obligation distinction was independently reopened: [Japanese teacher explanation](https://mainichi-nonbiri.com/grammar/n3-wakenihaikanai/). The other previously reviewed dictionary/NHK/teacher sources are linked in the historical findings and C correction review.

The original public 62-scenario snapshot was preserved. F ran the actual correct-sources.ts snapshot command into a distinct new file; its SHA256 is `27f5ac8361484c0a265a7298056cedf127f5876effb517d40a0cab6bc7cae687`. New translation artifact SHA256 is `a7674b3008ba5ab145369a37bca161474a67cb7905ac58f3f005ecfe66a545f0`; correction plan SHA256 is `8bdaeb4aee7c17481691af81f23edf299f48454110ba182b87a07c6c3d1edd53`.

The corrected snapshot plus actual prepare-scenarios/import CLI again produced 223 grammar +223 examples +6 relations +94 scenarios = **546 current source-bound English records**, with all existing coverage, hidden-answer, preservation and stale-source tests passing. New source-correction.acceptance-spec.ts tests actual local Postgres paths with no prior English and with all five affected old English versions. Preview leaves state unchanged; source drift and translation provenance drift reject atomically; second apply is a complete no-op including timestamps; unrelated source rows and old hash versions remain unchanged. The affected fixture has 5 translations without prior English or 9 versions with prior English, as expected (four new hashes, relation shares its source hash). C's full 550-version DB report is separate from F's fixture; F does not mislabel the subset as a fresh full-550 verification.

Reproduce with two inputs:

```sh
npx tsx scripts/content-localization/correct-sources.ts --snapshot "$ACCEPTANCE_ORIGINAL_STATIC_SNAPSHOT" --output /tmp/f-corrected-static.json
ACCEPTANCE_STATIC_SNAPSHOT=/tmp/f-corrected-static.json npx jest --config test/sentence-lab/jest.json --runInBand
```

Export ACCEPTANCE_ORIGINAL_STATIC_SNAPSHOT to the preserved public four-table snapshot before running. Output must not already exist. The generated full snapshot is not committed. This round adds two tests to the prior 36; **38/38 across eight suites passed** against the C correction and later D runtime commit. All databases were isolated and dropped. No production content was changed.
