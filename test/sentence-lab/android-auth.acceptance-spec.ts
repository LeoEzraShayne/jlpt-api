import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { AndroidAuthService } from '../../src/android-commerce/android-auth.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { AuthService } from '../../src/auth/auth.service';
let h: AcceptanceDatabase;
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
async function fixture() {
  const config = new ConfigService({
    ANDROID_COMMERCE_ENABLED: true,
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    BILLING_ENVIRONMENT: 'test',
    DATABASE_URL: h.connectionString,
    FRONTEND_URL: 'https://example.test',
    SESSION_SECRET: 'fixture-session-secret-32-characters',
  });
  const web = new AuthService(h.prisma as PrismaService, config);
  const profile = {
    providerId: randomUUID(),
    email: `${randomUUID()}@example.test`,
    displayName: 'Android fixture',
  };
  const login = await web.loginWithGoogle(profile);
  const source = await web.authenticate(login.rawToken);
  const auth = new AndroidAuthService(
    h.prisma as PrismaService,
    new AndroidPolicy(config),
  );
  const verifier = randomBytes(32).toString('base64url');
  const started = await auth.start({
    clientId: 'android-test',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  });
  const approved = await auth.approve(
    started.bindingId,
    source.user.id,
    source.id,
  );
  const code = new URL(approved.callbackUrl).searchParams.get('code')!;
  return { config, auth, web, login, profile, source, started, verifier, code };
}
test('PKCE exchange is single use under concurrency and stores no bearer/code plaintext', async () => {
  const f = await fixture();
  const responses = await Promise.allSettled(
    Array.from({ length: 4 }, () =>
      f.auth.exchange('android-test', f.code, f.verifier),
    ),
  );
  const success = responses.filter((r) => r.status === 'fulfilled');
  expect(success).toHaveLength(1);
  const token = success[0].value;
  const verified = await f.auth.authenticate(`Bearer ${token.accessToken}`);
  expect(verified.user.id).toBe(f.source.user.id);
  expect(token.googlePlayAccountId).toHaveLength(43);
  const binding = await h.prisma.androidBindingRequest.findUniqueOrThrow({
    where: { id: f.started.bindingId },
  });
  expect(binding.codeHash).not.toBe(f.code);
  expect(verified.session.tokenHash).not.toBe(token.accessToken);
  expect(verified.session.expiresAt.getTime()).toBeLessThanOrEqual(
    f.source.expiresAt.getTime(),
  );
});
test('wrong PKCE/client and repeated approval fail without extending approved deadline', async () => {
  const f = await fixture();
  const original = await h.prisma.androidBindingRequest.findUniqueOrThrow({
    where: { id: f.started.bindingId },
  });
  await expect(
    f.auth.exchange(
      'android-test',
      f.code,
      randomBytes(32).toString('base64url'),
    ),
  ).rejects.toMatchObject({ response: { code: 'BINDING_INVALID' } });
  await expect(
    f.auth.exchange('android-release', f.code, f.verifier),
  ).rejects.toMatchObject({ response: { code: 'ANDROID_CLIENT_MISMATCH' } });
  await expect(
    f.auth.approve(f.started.bindingId, f.source.user.id, f.source.id),
  ).rejects.toMatchObject({ response: { code: 'BINDING_EXPIRED' } });
  expect(
    await h.prisma.androidBindingRequest.findUnique({
      where: { id: f.started.bindingId },
    }),
  ).toEqual(original);
});
test('source logout immediately invalidates bearer; another device keeps its Web session', async () => {
  const f = await fixture();
  const other = await f.web.loginWithGoogle(f.profile);
  const token = await f.auth.exchange('android-test', f.code, f.verifier);
  await f.web.logout(f.login.rawToken);
  await expect(
    f.auth.authenticate(`Bearer ${token.accessToken}`),
  ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  expect((await f.web.authenticate(other.rawToken)).user.id).toBe(
    f.source.user.id,
  );
});
test('replacing the browser login invalidates its old native binding only', async () => {
  const f = await fixture();
  const token = await f.auth.exchange('android-test', f.code, f.verifier);
  const other = await f.web.loginWithGoogle(f.profile);
  await f.web.loginWithGoogle(
    {
      ...f.profile,
      providerId: randomUUID(),
      email: `${randomUUID()}@example.test`,
    },
    f.login.rawToken,
  );
  await expect(
    f.auth.authenticate(`Bearer ${token.accessToken}`),
  ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  expect((await f.web.authenticate(other.rawToken)).user.id).toBe(
    f.source.user.id,
  );
});
test('source user mismatch and expiry are checked on every bearer request', async () => {
  const f = await fixture();
  const token = await f.auth.exchange('android-test', f.code, f.verifier);
  const stranger = await h.prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, displayName: 'stranger' },
  });
  await h.prisma.authSession.update({
    where: { id: f.source.id },
    data: { userId: stranger.id },
  });
  await expect(
    f.auth.authenticate(`Bearer ${token.accessToken}`),
  ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  await h.prisma.authSession.update({
    where: { id: f.source.id },
    data: { userId: f.source.user.id, expiresAt: new Date(0) },
  });
  await expect(
    f.auth.authenticate(`Bearer ${token.accessToken}`),
  ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
});
test('expired approval code and test environment targeting production database fail closed', async () => {
  const f = await fixture();
  await h.prisma.androidBindingRequest.update({
    where: { id: f.started.bindingId },
    data: { codeExpiresAt: new Date(0) },
  });
  await expect(
    f.auth.exchange('android-test', f.code, f.verifier),
  ).rejects.toMatchObject({ response: { code: 'BINDING_INVALID' } });
  f.config.set('DATABASE_URL', 'postgresql://localhost/jlpt');
  await expect(f.auth.details(f.started.bindingId)).rejects.toMatchObject({
    response: { code: 'ANDROID_TEST_DATABASE_FORBIDDEN' },
  });
});
