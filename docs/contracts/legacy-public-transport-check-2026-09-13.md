# Legacy Web transport and payment entry: read-only evidence

Observed 2026-09-13, approximately 07:07–07:11 UTC. This covers the fixed legacy
entry `https://web.meritledger.org` retained by the Android recovery UI. No account
login, authenticated user read, file upload, media enumeration, payment creation,
purchase confirmation, or Console action was performed.

## Current public deployment

| Read-only observation | Result |
| --- | --- |
| `https://web.meritledger.org/` | GET 200, public title 功过格 |
| Deployed JS `/assets/index-B5yDsRyv.js` | Contains API base `https://api.meritledger.org/api` |
| `https://web.meritledger.org/membership` | HEAD 200; SPA availability, not an authenticated membership-page test |
| `https://api.meritledger.org/api/health` | GET 200 |
| `https://api.meritledger.org/api/env` | GET 200, `api_base=https://api.meritledger.org/api/` |
| `http://api.meritledger.org/api/health` | HEAD 301 to the corresponding HTTPS URL |
| `https://api.meritledger.org/uploads/` | HEAD 404; TLS endpoint answers with HSTS and a CSP containing `upgrade-insecure-requests` |
| `https://api.meritledger.org/api/membership/payment/config` | GET 200, `stripe.enabled=true`, publishable key present with live-mode prefix; key omitted from evidence |

The production Web's API base is HTTPS. The local developer fallback to loopback
HTTP is not the value found in the deployed bundle and is not evidence of a live
plaintext-data path. The upload-directory HEAD did not request any user's file;
it does not prove a particular stored image or audio object exists or loads.

## Ordinary source evidence and remaining bounds

Local legacy repositories examined: Web `cb466b9`, backend `5c78698`. Their heads
are source context, not independently established running-backend revision IDs.

- `merit-ledger-web/src/api/client.ts:14` takes the configured API base; relative
  media paths use that API origin. Full `http:` or `https:` asset URLs are preserved.
- `merit-ledger_backend/src/utils/uploadSupport.js:163` generates absolute media
  URLs from `req.protocol` and the request host. Image/audio upload handlers use
  this helper. The checked-in nginx setup forwards `X-Forwarded-Proto`; a deployed
  nginx and Express trust-proxy check is still needed to establish which scheme
  the running helper receives. No upload was made to manufacture that evidence,
  and no existing user's stored media URLs were read.
- The local Web membership page still connects plan purchase buttons to Stripe
  PaymentIntent creation and uses Stripe Payment Element. Backend routes expose
  the public configuration before authentication and require authentication for
  create-intent/confirm. `getStripePublicConfig()` derives enabled status from
  the presence of a Stripe secret, so the public response establishes enabled
  configuration, not that the secret remains valid or a charge would succeed.
  The local Stripe service uses `https://api.stripe.com/v1`.

Current evidence therefore supports an HTTPS legacy Web/API and a still-exposed
live-configured Stripe purchase entry. It neither establishes a media plaintext
incident nor completes an actual payment or media-upload acceptance. No service-
provider contract or data-sharing exemption was verified in this technical check;
such an exemption must not be inferred from the use of Stripe or an HTTPS URL.
