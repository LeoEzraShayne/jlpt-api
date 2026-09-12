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

## W1 integration progress (before independent acceptance)

- C integrated as 0d9cb67: 546 translations cover production static corpus plus all currently generatable scenarios; original Japanese/Chinese retained. 92 translation/review provider calls preserved in usage audit; one-time cost estimate $0.06569925. Independent language validation pending.
- B initial Web delivery integrated as 25c40eb; browser found and routed onboarding-vs-membership redirect, partial English labels, and mobile header crowding for correction.
- Main operated real Stripe **Sandbox** hosted Checkout with published synthetic test card: USD 99 cents DAY_PASS -> signed webhook -> PAID with one 86,400-second grant. A subsequently tested repeated callbacks, partial and full sandbox refund. Full Stripe checkout URL including hash fragment is required; early shortened test URL was invalid and corrected before payment.
- Test catalog has two products and five immutable one-time prices; protected test configuration and CLI signature listener are isolated from production. No live charge or live sales enablement.
- Desktop and 390x844 phone browser showed server-backed paid return, membership expiry, order history, and USD/JPY market selection. Local synthetic browser session is temporary and must be revoked at completion.
- Stripe Checkout displayed a **1% Climate contribution** for this merchant. Include this account-level cost alongside processing and applicable currency conversion when evaluating membership margins; do not silently disable the user's existing contribution setting.
- Production aggregate pre-metering records: DeepSeek/deepseek-chat 142 calls, average 752 input / 440 visible output; Gemini/gemini-3.5-flash 160 calls, 794 input / 579 visible output. These older rows omit complete thinking/cache/failure/retry cost and cannot certify member economics.
