# Confirmed USD base pricing and channel fees — 2026-09-13

The owner approved one global USD price set: DAY_PASS $0.99 / 24 hours; YEAR_PASS $64 / 365 days for the first 90 days from Web charging activation, then $99 / 365 days. Prices are one-time, not recurring. The owner expressly accepted Google Play automatic conversion to local buyer currencies, including JPY in Japan. There is no independent Japanese discount or fixed JPY price. Web Stripe uses USD. Buying currency, merchant payout currency and accounting currency are different concepts.

This supersedes the original USD99.99/JPY6400 rules and the unapproved $499/$599 proposal. Price approval does not mean live payment configuration, a successful customer purchase or launch activation has happened. The previous pricing-decision gate is resolved; remaining provider-route validation and commercial configuration are tracked separately.

## Current account evidence and net revenue

The main agent read the existing Play Console account group's **registered programs and services** on 2026-09-13: it explicitly shows **15% service fee tier**. No enrollment, acceptance of terms, association edit or permission change was performed.

| Product | USD base price | Stripe conservative net | Google Play 15% net | Google 30% sensitivity |
|---|---:|---:|---:|---:|
| Day pass | $0.99 | $0.92466 | $0.84150 | $0.69300 |
| Launch year | $64 | $59.776 | $54.40 | $44.80 |
| Standard year | $99 | $92.466 | $84.15 | $69.30 |

These are **fee-only calculations on an assumed tax-exclusive product amount**, not final merchant payouts or profits. Stripe assumes Japanese standard card processing 3.6%, conditional currency conversion 2%, plus the account's existing 1% Climate contribution. Climate is not a Stripe processing fee. If conversion is unnecessary, the 2% does not apply. The Google 30% column is a sensitivity budget, not a claim that the enrolled account currently pays 30% or that 30% is a universal future ceiling. Do not stack Stripe fees onto ordinary Google Play Billing purchases.

The qualified DeepSeek batches imply $26.1518–$33.4941 annual AI for 40 successful corrections/day, 365 active days, half vocabulary with one fresh generation per vocabulary correction, peak/cold pricing, including sampled repairs. Thus the launch annual contribution after fee + AI is about **$26.28–33.62 on Stripe**, **$20.91–28.25 at Google15%**, or **$11.31–18.65 at Google30%**, before fixed infrastructure, free users, tax, refunds, support, acquisition and overages. Ranges describe sample differences, not confidence intervals or actual user distributions. The upper historical figure can differ slightly by rounding; the audit JSON is controlling.

The owner chose 40/day as the ordinary planning scenario and 120/day as heavy use. Neither is a product limit. At 120/day AI remains approximately $78–100/year and can exceed launch-year proceeds; that risk remains visible and is not erased by the ordinary-use assumption. Gemini free usage is not credited in the budget; it can reduce actual cost only after the requested Gemini-first route passes quality/fallback validation. Do not enable Gemini paid billing or weaken its key/IP protection automatically.

## Google regional transition and automatic conversion

[Google's current published transition](https://support.google.com/googleplay/android-developer/answer/16954621) distinguishes service fees from an additional Play Billing fee. It began in EEA/UK/US on June30,2026, where the first-$1M tier is 10% service +5% billing. Japan/Australia rollout is scheduled September30,2026; the page says other regions' additional billing fee details are forthcoming. Do not label 15% a guaranteed worldwide rate for the entire membership term or silently assume Japan's future billing fee is 5%. Recheck the effective region/date/program when Android products and release are configured.

The dollar amount is the base input to Google price conversion. Google uses its exchange rate, applicable tax treatment, local price patterns and valid price ranges when generating regional prices. Review and record the resulting prices at product setup and at the shared launch cutoff. “Automatic conversion” does not mean every storefront price changes continuously with daily FX. Actual order currency/amount/tax/fees remain immutable order evidence. Do not hardcode a guessed USD/JPY exchange rate into entitlement verification.

## Sources checked this turn

- [Stripe Japan pricing](https://stripe.com/jp/pricing): card3.6%, +2% where conversion is required.
- [Google 15% enrollment and first-$1M rules](https://support.google.com/googleplay/android-developer/answer/10632485): enrollment conditions and annual threshold; actual enrollment read directly from the existing console.
- [Google fee transition](https://support.google.com/googleplay/android-developer/answer/16954621): regional dates, install cohorts, separate billing fee.
- [Google buyer and payout currencies](https://support.google.com/googleplay/android-developer/answer/1169947): buyers use supported local currency; payout follows the payments profile.
- [Google base-price conversion](https://support.google.com/googleplay/android-developer/answer/6334373): FX, tax and local pricing patterns; local currency is fixed by country.
- [Qualified AI audit](../../test/sentence-lab/ai-audit/route-held-out/MIXED-REVIEW.md): actual sample receipts and historical higher-cost comparison. Older historical reports retain their original price assumptions rather than being rewritten.

## API deployment evidence

API runtime `a9a064a0c45bc9b8dde64ae92e3fca3214222ba8` is deployed in `/var/www/jlpt-releases/a9a064a0c45b`, retaining the previous `c56194b1bb26` release. No schema migration was needed. The release has independent npm dependencies and Prisma generation; its archive SHA-256 is `608523ab7af1a909862183e86426dd2ba2584ac461161a9e53ac69eaa510a3f9`. Fresh protected database backup `/var/www/jlpt-backups/before-usd-pricing-a9a064a.dump` passed archive inspection, SHA-256 `a8d7ba751d651b3602d45d6d02376287a74f291c19e117c14a1c33410c371800`; a protected PM2 backup is retained alongside it. The first directory-creation attempt lacked permission and stopped before modifying the running release; the retry created only the new release with the expected owner.

Twelve checkout/entitlement acceptance checks and nine billing integration checks passed, along with build, TypeScript, lint, line checks and [API CI](https://github.com/LeoEzraShayne/jlpt-api/actions/runs/34723500989). Existing quotes omit the new Adaptive Pricing parameter, preserving provider idempotency.

After the guarded symlink switch and PM2 reload/save, health passed at `2026-09-12T22:46:08.226Z`. The legacy `market=JP` catalog returned USD99 cents / USD9900 cents, with `salesEnabled:false`, `launchAt:null`, `launchEndsAt:null`. This confirms global pricing without starting the offer or gift clocks. The grammar-thinking DeepSeek route and existing protected environment were retained. Gemini-first deployment remains separate pending its required validation.
