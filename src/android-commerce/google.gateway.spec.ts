import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { GoogleGateway } from './google.gateway';
import { AndroidPolicy } from './android.policy';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
function fixture() {
  const config = new ConfigService({
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    BILLING_ENVIRONMENT: 'test',
    DATABASE_URL: 'postgresql://localhost/isolated_test',
    GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    GOOGLE_RTDN_AUDIENCE: 'https://example.test/rtdn',
    GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: 'push@example.iam.gserviceaccount.com',
  });
  const gateway = new GoogleGateway(new AndroidPolicy(config));
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        keys: [{ ...keys.publicKey.export({ format: 'jwk' }), kid: 'fixture' }],
      }),
      { status: 200 },
    ),
  );
  const jwt = (overrides: Record<string, unknown> = {}) => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const body = `${encode({ alg: 'RS256', kid: 'fixture' })}.${encode({ iss: 'https://accounts.google.com', aud: 'https://example.test/rtdn', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000), email: 'push@example.iam.gserviceaccount.com', email_verified: true, ...overrides })}`;
    return `${body}.${sign('RSA-SHA256', Buffer.from(body), keys.privateKey).toString('base64url')}`;
  };
  return { config, gateway, jwt };
}
afterEach(() => jest.restoreAllMocks());
test('authenticated PubSub requires cryptographic signature and exact issuer/audience/email/expiry', async () => {
  const f = fixture();
  await f.gateway.verifyPush(`Bearer ${f.jwt()}`);
  for (const claim of [
    { aud: 'other' },
    { email: 'other@example.test' },
    { email_verified: false },
    { exp: 0 },
    { iss: 'https://evil.test' },
    { iat: Math.floor(Date.now() / 1000) + 500 },
  ])
    await expect(
      f.gateway.verifyPush(`Bearer ${f.jwt(claim)}`),
    ).rejects.toMatchObject({ response: { code: 'INVALID_RTDN_AUTH' } });
  await expect(
    f.gateway.verifyPush(`Bearer ${f.jwt().slice(0, -8)}fakefake`),
  ).rejects.toMatchObject({ response: { code: 'INVALID_RTDN_AUTH' } });
});
test('versioned authenticated encryption rejects tampering and cross-environment replay', () => {
  const f = fixture(),
    token = randomBytes(32).toString('base64url');
  const envelope = f.gateway.encrypt(token);
  expect(f.gateway.decrypt(envelope)).toBe(token);
  const parts = envelope.split('.');
  parts[3] = Buffer.from('tampered').toString('base64url');
  expect(() => f.gateway.decrypt(parts.join('.'))).toThrow();
  f.config.set('ANDROID_COMMERCE_ENVIRONMENT', 'live');
  expect(() => f.gateway.decrypt(envelope)).toThrow();
});

test('voided bootstrap omits startTime while incremental scans preserve bounds and pagination', async () => {
  const { gateway } = fixture();
  const request = jest
    .spyOn(
      gateway as unknown as { request(path: string): Promise<unknown> },
      'request',
    )
    .mockResolvedValue({});
  await gateway.voided(undefined, 1234);
  const bootstrap = new URL(request.mock.calls[0][0], 'https://example.test');
  expect(bootstrap.searchParams.has('startTime')).toBe(false);
  expect(bootstrap.searchParams.get('endTime')).toBe('1234');
  expect(bootstrap.searchParams.get('includeQuantityBasedPartialRefund')).toBe(
    'true',
  );
  await gateway.voided(1000, 1234, 'page+/=');
  const incremental = new URL(request.mock.calls[1][0], 'https://example.test');
  expect(incremental.searchParams.get('startTime')).toBe('1000');
  expect(incremental.searchParams.get('endTime')).toBe('1234');
  expect(incremental.searchParams.get('token')).toBe('page+/=');
});
