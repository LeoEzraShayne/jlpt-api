import Stripe from 'stripe';

// Read-only: never creates a Checkout, payment, price, webhook or database row.
const expectedAccount = 'acct_1StQhPKId1Bt4Wq3';
const endpointUrl =
  'https://api.jlpt.meritledger.org/api/v1/billing/webhooks/stripe';
const requiredEvents = [
  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_reinstated',
  'charge.dispute.funds_withdrawn',
];

async function main() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (
    process.env.BILLING_ENVIRONMENT !== 'live' ||
    !key?.match(/^(sk|rk)_live_/)
  )
    throw new Error('LIVE_CONFIGURATION_REQUIRED');
  const stripe = new Stripe(key, { maxNetworkRetries: 1, timeout: 20_000 });
  const checks: Record<string, boolean> = {};
  const account = await stripe.accounts.retrieveCurrent();
  checks.accountMatches = account.id === expectedAccount;
  if (!checks.accountMatches) throw new Error('STRIPE_ACCOUNT_MISMATCH');
  checks.chargesEnabled = account.charges_enabled;
  checks.payoutsEnabled = account.payouts_enabled;
  checks.cardPaymentsActive = account.capabilities?.card_payments === 'active';
  for (const [name, amount] of [
    ['STRIPE_PRICE_DAY_USD', 99],
    ['STRIPE_PRICE_YEAR_USD_LAUNCH', 6400],
    ['STRIPE_PRICE_YEAR_USD_STANDARD', 9900],
  ] as const) {
    const id = process.env[name];
    if (!id) {
      checks[name] = false;
      continue;
    }
    const price = await stripe.prices.retrieve(id, { expand: ['product'] });
    checks[name] =
      price.livemode &&
      price.active &&
      price.type === 'one_time' &&
      price.currency === 'usd' &&
      price.unit_amount === amount &&
      typeof price.product !== 'string' &&
      !price.product.deleted &&
      price.product.active;
  }
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  const matching = endpoints.data.filter(
    (endpoint) => endpoint.url === endpointUrl && endpoint.status === 'enabled',
  );
  checks.liveWebhookConfigured = matching.some(
    (endpoint) =>
      endpoint.livemode &&
      endpoint.api_version === Stripe.API_VERSION &&
      requiredEvents.every(
        (event) =>
          endpoint.enabled_events.includes('*') ||
          endpoint.enabled_events.includes(event),
      ),
  );
  checks.webhookSecretPresent =
    !!process.env.STRIPE_WEBHOOK_SECRET?.startsWith('whsec_');
  const passed = Object.values(checks).every(Boolean);
  process.stdout.write(
    JSON.stringify({
      passed,
      checks,
      sdkApiVersion: Stripe.API_VERSION,
      limitation:
        'Presence cannot prove webhook secret match or delivery. No payment, ' +
        'database activation, Gemini quality or key expiration validation occurred.',
    }) + '\n',
  );
  if (!passed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  // Stripe errors may carry request headers and private account fields.
  const safeCodes = new Set([
    'LIVE_CONFIGURATION_REQUIRED',
    'STRIPE_ACCOUNT_MISMATCH',
  ]);
  const code =
    error instanceof Error && safeCodes.has(error.message)
      ? error.message
      : 'STRIPE_READINESS_QUERY_FAILED';
  process.stderr.write(JSON.stringify({ passed: false, code }) + '\n');
  process.exitCode = 1;
});
