# Android A1 backend implementation

This implements the frozen [commerce contract](android-commerce-v1.md). It is
local code and isolated-database validation, not evidence that Google Play or
AdMob production is ready. Android sales/reward flags remain off. Existing Web
sales and the shared launch clock are unchanged.

## Implemented behavior

- Browser-approved, single-use S256 binding codes produce scoped native bearer
  sessions. Every native request checks the original Web session and its user
  and expiry. Replacing or logging out that Web session invalidates its native
  sessions without revoking unrelated devices.
- Google purchase tokens are encrypted at rest. Authenticated RTDN receipt and
  its durable purchase queue link commit together before returning success.
  Unknown owners remain queued until the trusted Google account identifier can
  be matched. Client price and client account claims cannot grant membership.
- Google purchase and order APIs provide product, environment, account, original
  money and cumulative successful refund evidence. Integer currency conversion
  avoids floating-point arithmetic. Full Google event timestamps retain their
  nanosecond precision. Paid orders and membership grants commit before consume.
  Queue updates use revision and expiring lease fences; losing the final fence
  rolls back the entire ledger transaction. Refund state is terminal.
- New sale catalog visibility uses both Android switches and the shared Web
  launch clock. Verification remains available for already-paid transactions
  when new sales are disabled. The app must display the actual Play localized
  price and choose the exact offer returned by its billing SDK.
- Voided purchase synchronization scans a fixed overlapping interval and all its
  pages. Only a complete successful scan advances the fenced watermark. It does
  not resume in the middle of pagination. A gap beyond Google's 30-day history
  records `GOOGLE_VOIDED_HISTORY_GAP` for operator investigation.
- AdMob tickets bind a random secret, anonymous user alias, numeric SSV ad unit,
  reward item and earning window. Only Google ECDSA-verified SSV can award one
  task. Transaction and ticket replay cannot award twice. Members cannot create
  ad tickets. Already-earned rewards remain valid after new rewards are disabled.

## Runtime configuration and operations

Use the environment names and routes in the frozen contract. The service account
file must be supplied by the deployment owner; this implementation does not
create it or modify Play Console permissions. `GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY`
must be **64 hexadecimal characters (32 bytes)**. Retain it while any encrypted
queue token may need verification or refund recovery; changing it without a
migration makes those tokens unreadable. It is separate from session signing.

The queue drain runs every 15 seconds and voided synchronization every hour when
the service account file is configured. Monitor due purchase rows, `attempts`,
`errorCode`, `consumeState`, and sync `watermarkAt`/`lastSuccessAt`/`errorCode`.
Failure does not remove queue records. An expired lease becomes claimable again.
Do not resolve a history-gap error by silently advancing the watermark: reconcile
the missing interval using authoritative order evidence first.

RTDN requires Google's OIDC signature, issuer, exact configured audience and
verified service-account email, plus the exact Pub/Sub subscription. Its body is
a hint: purchase state is independently fetched from Google. SSV requires the
raw callback query to reach the handler unchanged. Signature processing follows
[Google's Tink verifier](https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/main/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifier.java):
URI query percent-decoding once, preserving literal plus characters, before
verification. Duplicate or ambiguous parameters are rejected. The SDK full
`ca-app-pub-…/…` unit and Google's numeric `ad_unit` are stored separately.

Test and live backends must use separate databases. Test mode refuses the
production database name `jlpt`. The app client ID, provider purchase context,
ledger environment and ticket environment must agree. Google signatures alone
do not certify a callback as a production ad impression; platform validation
must continue to use the isolated test backend and approved test inventory.

## Validation and remaining release evidence

Automated coverage includes real isolated PostgreSQL transactions for binding
replay, source-session revocation, foreign-account access, pending and refunded
purchases, encrypted RTDN durability, failed consume retries, stale workers,
exact cumulative refunds, watermark failure, signed SSV encoding, reward replay
and native HTTP authorization. Provider responses use controlled fixtures;
cryptographic checks use real generated signatures. No live purchase, production
callback, service-account secret or console change was used for these tests.

Local validation: 428 unit tests passed; 93 isolated PostgreSQL acceptance tests
passed across 16 suites with the two snapshot-dependent content suites excluded.
TypeScript checking, production build, scoped ESLint, and the 500-line source
limit also passed. The independent Google regression suite includes loss of the
final transaction fence followed by successful retry recovery.

Before enabling Android sales or rewards, the release owner still needs actual
Play product/offer setup and localized prices, service-account access, authenticated
RTDN delivery, license-tester purchase/consume/refund evidence, App Links/device
binding evidence, and AdMob store-link/review plus isolated SSV delivery evidence.
The existence of a previously approved AdMob account does not satisfy app review.

The repository-wide sentence-lab content/source-correction tests additionally
require their explicit static snapshot fixtures; a run without those fixtures
is not a passing full-suite result.
