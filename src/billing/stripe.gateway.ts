import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { billingError } from './billing.policy';

@Injectable()
export class StripeGateway {
  private client?: Stripe;
  constructor(private readonly config: ConfigService) {}
  get environment(): 'test' | 'live' {
    return this.config.get('BILLING_ENVIRONMENT', 'test');
  }
  get stripe() {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key || !new RegExp(`^(sk|rk)_${this.environment}_`).test(key))
      billingError('PAYMENT_UNAVAILABLE', 503);
    // SDK 22.6.2 pins its current stable API; use the SDK default deliberately.
    return (this.client ??= new Stripe(key, {
      maxNetworkRetries: 2,
      timeout: 20_000,
    }));
  }
  verify(payload: Buffer, signature: string) {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) billingError('PAYMENT_UNAVAILABLE', 503);
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        secret,
      );
      if (event.livemode !== (this.environment === 'live'))
        billingError('INVALID_STRIPE_ENVIRONMENT', 400);
      return event;
    } catch {
      billingError('INVALID_STRIPE_SIGNATURE', 400);
    }
  }
}
