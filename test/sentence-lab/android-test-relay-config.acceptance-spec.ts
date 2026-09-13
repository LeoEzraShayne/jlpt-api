import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { relayIsolationConfig } from './android-test-relay-config';

test('standalone relay supplies actual policy isolation inputs without environment fallback', () => {
  const config = relayIsolationConfig('jlpt_f_acceptance_test_123_abcdef');
  const policy = new AndroidPolicy(config);
  expect(() => policy.assertIsolation()).not.toThrow();
  expect(config.get('BILLING_ENVIRONMENT')).toBe('test');
  expect(new URL(config.getOrThrow('DATABASE_URL')).hostname).toBe('localhost');
  config.set('DATABASE_URL', 'postgres://localhost/jlpt');
  expect(() => policy.assertIsolation()).toThrow();
});

test.each([
  undefined,
  'jlpt',
  'production',
  '../jlpt',
  'jlpt_f_acceptance_test_1_a?host=remote',
])('relay rejects a nonisolated state database %s', (database) => {
  expect(() => relayIsolationConfig(database)).toThrow(
    'RELAY_ISOLATED_DATABASE_REQUIRED',
  );
});
