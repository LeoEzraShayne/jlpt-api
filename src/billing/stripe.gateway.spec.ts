import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { StripeGateway } from './stripe.gateway';

describe('Stripe webhook trust boundary', () => {
  const secret = 'whsec_test_fixture_only';
  const config = new ConfigService({
    BILLING_ENVIRONMENT: 'test',
    STRIPE_SECRET_KEY: 'sk_test_fixture_only',
    STRIPE_WEBHOOK_SECRET: secret,
  });
  const gateway = new StripeGateway(config);
  const stripe = new Stripe('sk_test_fixture_only');
  const body = JSON.stringify({
    id: 'evt_fixture',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { id: 'cs_fixture' } },
  });
  it('requires intact signed raw bytes', () => {
    const signature = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret,
    });
    expect(gateway.verify(Buffer.from(body), signature).id).toBe('evt_fixture');
    expect(() => gateway.verify(Buffer.from(`${body} `), signature)).toThrow();
    expect(() => gateway.verify(Buffer.from(body), 'forged')).toThrow();
  });
  it('rejects signed live events with test credentials and accepts restricted key configuration', () => {
    const live = body.replace('"livemode":false', '"livemode":true');
    expect(() =>
      gateway.verify(
        Buffer.from(live),
        stripe.webhooks.generateTestHeaderString({ payload: live, secret }),
      ),
    ).toThrow();
    expect(
      () =>
        new StripeGateway(
          new ConfigService({
            BILLING_ENVIRONMENT: 'test',
            STRIPE_SECRET_KEY: 'rk_test_fixture_only',
          }),
        ).stripe,
    ).not.toThrow();
    expect(
      () =>
        new StripeGateway(
          new ConfigService({
            BILLING_ENVIRONMENT: 'live',
            STRIPE_SECRET_KEY: 'sk_test_fixture_only',
          }),
        ).stripe,
    ).toThrow();
  });
});
