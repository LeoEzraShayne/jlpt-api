# W0 verification — 2026-09-13

- API baseline fa763aa8219adbd1b52d121ed776d8510776b6a4, Web 3575ab98ab6aa362d4096bd2955ae4a16a6e55f6; clean before work.
- Shared foundation: API 8b22ede + baae93b; Web 92e9ad7 + a112bc0 + fb3efd1.
- Prisma format/validate/generate succeeded. Migration SQL derived from prior schema without touching production.
- Local backup restored to isolated `jlpt_sentence_lab_content_20260913`, additive migration applied in single PostgreSQL transaction. Backup is protected outside repositories.
- API build succeeded. Existing unit tests 45 suites / 374 tests passed. Existing DB integration 12 suites / 53 tests passed after fixing DATE-vs-timestamp assertion at Tokyo midnight; scheduling implementation unchanged. Node pg concurrent query deprecation remains for existing test harness.
- Production read-only: `/var/www/jlpt-api` -> `/var/www/jlpt-releases/fa763aa`, PM2 jlpt-api online.
- Production static corpus: 223 GrammarPoint, 223 GrammarExample, 6 GrammarRelationGroup, 62 TrainingScenario. Export contains only these static tables.
- Stripe Leo Shayne Studio: Payments, Payouts, JCB, Link Active; Cartes Bancaires Paused; no active account tasks. Test mode entered, sandbox banner explicitly confirms no real transactions. No live sales configured/enabled.
- W1 agents A/B/C isolated under `/Users/shen/Downloads/jlpt/worktrees/`.

## Source checks reserved for W2 cost validation

- https://api-docs.deepseek.com/quick_start/pricing/ now lists deepseek-flash (V4.1) and peak/off-peak prices; old deepseek-chat model configuration must be revalidated against actual provider response. Peak USD/M input miss .30, hit .006, output 1.20; off-peak half. Do not assume legacy rate.
- https://ai.google.dev/gemini-api/docs/pricing includes output thinking in paid output rate; verify exact configured model and full provider usage.
- https://stripe.com/jp/pricing standard cards 3.6%, +2% where currency conversion is required. Other payment methods differ, including digital-content PayPay and convenience-store minimum fees. Cost acceptance must reflect enabled checkout methods.

This is baseline verification, not W1/W2 acceptance or production release.
