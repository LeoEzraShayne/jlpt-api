import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { billingError } from '../billing/billing.policy';

export function androidHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AndroidPolicy {
  constructor(readonly config: ConfigService) {}
  get environment(): 'test' | 'live' {
    return this.config.get('ANDROID_COMMERCE_ENVIRONMENT', 'test');
  }
  enabled(key: string) {
    const value = this.config.get<unknown>(key);
    return value === true || value === 'true';
  }
  assertIsolation() {
    const database = new URL(this.config.getOrThrow<string>('DATABASE_URL'));
    if (
      this.environment === 'test' &&
      decodeURIComponent(database.pathname) === '/jlpt'
    )
      billingError('ANDROID_TEST_DATABASE_FORBIDDEN', 503);
    if (!['test', 'live'].includes(this.environment))
      billingError('ANDROID_ENVIRONMENT_INVALID', 503);
    if (this.config.get('BILLING_ENVIRONMENT', 'test') !== this.environment)
      billingError('ANDROID_BILLING_ENVIRONMENT_MISMATCH', 503);
  }
  assertEnabled() {
    this.assertIsolation();
    if (!this.enabled('ANDROID_COMMERCE_ENABLED'))
      billingError('ANDROID_COMMERCE_DISABLED', 503);
  }
  assertClient(clientId: string) {
    this.assertEnabled();
    if (
      clientId !==
      (this.environment === 'live' ? 'android-release' : 'android-test')
    )
      billingError('ANDROID_CLIENT_MISMATCH', 403);
  }
  get packageName() {
    return this.config.get<string>(
      'GOOGLE_PLAY_PACKAGE_NAME',
      'com.meritledger.app',
    );
  }
}
