import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { AndroidCommerceModule } from '../../src/android-commerce/android-commerce.module';
import { AndroidAuthService } from '../../src/android-commerce/android-auth.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { AuthService } from '../../src/auth/auth.service';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OriginGuard } from '../../src/common/origin.guard';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { UsersModule } from '../../src/users/users.module';
import {
  ANDROID_SCOPES,
  type AndroidTokenResponse,
  type AndroidBindingCreated,
  type AndroidBindingDetails,
} from '../../src/contracts/android-commerce';
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
const errorCode = (response: request.Response) =>
  (response.body as { error: { code: string } }).error.code;

let h: AcceptanceDatabase;
let app: NestExpressApplication;
let auth: AndroidAuthService;
let web: AuthService;
let config: ConfigService;
const origin = 'https://android-acceptance.example.test';
const entropy = () => randomBytes(32).toString('base64url');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
const http = () => request(app.getHttpServer());
const path = '/api/v1/android/auth';
beforeAll(async () => {
  h = await acceptanceDatabase();
  // Actual controllers/guards and PG, synthetic identity only. No AppModule/.env/pollers/OAuth requests.
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        skipProcessEnv: true,
        load: [
          () => ({
            NODE_ENV: 'production',
            DATABASE_URL: h.connectionString,
            FRONTEND_URL: origin,
            SESSION_SECRET: 'independent-test-session-secret-32-characters',
            GOOGLE_CLIENT_ID: 'synthetic',
            GOOGLE_CLIENT_SECRET: 'synthetic',
            GOOGLE_CALLBACK_URL: `${origin}/api/v1/auth/google/callback`,
            ANDROID_COMMERCE_ENABLED: true,
            ANDROID_COMMERCE_ENVIRONMENT: 'test',
            BILLING_ENVIRONMENT: 'test',
          }),
        ],
      }),
      DatabaseModule,
      AndroidCommerceModule,
      UsersModule,
      ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ],
    providers: [
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      { provide: APP_GUARD, useClass: OriginGuard },
    ],
  })
    .overrideProvider(PrismaService)
    .useValue(h.prisma)
    .compile();
  app = module.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  auth = app.get(AndroidAuthService);
  web = app.get(AuthService);
  config = app.get(ConfigService);
});
afterAll(async () => {
  await app?.close();
  await h?.stop();
});
async function fixture() {
  const identity = randomUUID();
  const profile = {
    providerId: identity,
    email: `${identity}@example.test`,
    displayName: 'F independent',
  };
  const login = await web.loginWithGoogle(profile);
  const source = await web.authenticate(login.rawToken);
  const verifier = entropy();
  const state = entropy();
  const started = await auth.start({
    clientId: 'android-test',
    codeChallenge: digest(verifier),
    state,
  });
  return {
    profile,
    login,
    source,
    verifier,
    state,
    started,
    cookie: `jlpt_session=${login.rawToken}`,
  };
}
async function approved() {
  const f = await fixture();
  const response = await http()
    .post(`${path}/bindings/${f.started.bindingId}/approve`)
    .set('Cookie', f.cookie)
    .set('Origin', origin)
    .send({});
  expect(response.status).toBe(201);
  const callback = new URL(data<{ callbackUrl: string }>(response).callbackUrl);
  expect(callback.origin).toBe(origin);
  expect(callback.pathname).toBe('/android/callback/test');
  expect(callback.searchParams.get('state')).toBe(f.state);
  expect([...callback.searchParams.keys()].sort()).toEqual(['code', 'state']);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  return { ...f, code: callback.searchParams.get('code')! };
}
const exchange = (f: Awaited<ReturnType<typeof approved>>, extra = {}) =>
  http()
    .post(`${path}/exchange`)
    .send({
      clientId: 'android-test',
      code: f.code,
      codeVerifier: f.verifier,
      ...extra,
    });

test('HTTP approval requires both the Web cookie and exact trusted Origin; failure leaves request unapproved', async () => {
  const f = await fixture();
  const approve = `${path}/bindings/${f.started.bindingId}/approve`;
  for (const supplied of [
    '',
    'https://evil.example.test',
    `${origin}.evil.test`,
  ]) {
    const response = await http()
      .post(approve)
      .set('Cookie', f.cookie)
      .set('Origin', supplied)
      .send({});
    expect(response.status).toBe(403);
    expect(errorCode(response)).toBe('INVALID_ORIGIN');
  }
  expect(
    (await http().post(approve).set('Origin', origin).send({})).status,
  ).toBe(401);
  expect(
    (
      await h.prisma.androidBindingRequest.findUniqueOrThrow({
        where: { id: f.started.bindingId },
      })
    ).approvedAt,
  ).toBeNull();
  expect(
    (await http().get(`${path}/bindings/${f.started.bindingId}`)).status,
  ).toBe(401);
  const details = await http()
    .get(`${path}/bindings/${f.started.bindingId}`)
    .set('Cookie', f.cookie);
  expect(details.status).toBe(200);
  expect(Object.keys(data<AndroidBindingDetails>(details)).sort()).toEqual([
    'clientId',
    'expiresAt',
    'scopes',
  ]);
});

test('DTO strips ownership/scopes/callback injection; native binding start is Origin-exempt only at exact path', async () => {
  const input = {
    clientId: 'android-test',
    codeChallenge: digest(entropy()),
    state: entropy(),
    userId: 'attacker',
    sourceSessionId: 'attacker',
    approvedAt: new Date().toISOString(),
    scopes: ['admin'],
    callbackUrl: 'https://evil.example.test',
  };
  const response = await http().post(`${path}/bindings`).send(input);
  expect(response.status).toBe(201);
  expect(response.headers['cache-control']).toBe('no-store');
  const row = await h.prisma.androidBindingRequest.findUniqueOrThrow({
    where: { id: data<AndroidBindingCreated>(response).bindingId },
  });
  expect(row.userId).toBeNull();
  expect(row.sourceSessionId).toBeNull();
  expect(row.approvedAt).toBeNull();
  expect(
    new URL(data<AndroidBindingCreated>(response).authorizationUrl).origin,
  ).toBe(origin);
  expect((await http().post(`${path}/bindings/`).send(input)).status).toBe(403);
  expect((await http().put(`${path}/bindings`).send(input)).status).toBe(404);
  expect(
    (
      await http()
        .post(`${path}/bindings`)
        .send({ ...input, codeChallenge: 'plain' })
    ).status,
  ).toBe(400);
});

test('eight actual HTTP exchanges have one winner; invalid verifier/client cannot consume the code or request broader scopes', async () => {
  const f = await approved();
  expect((await exchange(f, { codeVerifier: entropy() })).status).toBe(401);
  expect((await exchange(f, { clientId: 'android-release' })).status).toBe(403);
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      exchange(f, { scopes: ['admin'], userId: 'attacker' }),
    ),
  );
  const winners = responses.filter((r) => r.status === 201);
  expect(winners).toHaveLength(1);
  expect(responses.filter((r) => r.status === 401)).toHaveLength(7);
  const result = data<AndroidTokenResponse>(winners[0]);
  expect(result.scopes).toEqual(ANDROID_SCOPES);
  expect(result.user.id).toBe(f.source.user.id);
  expect(winners[0].headers['cache-control']).toBe('no-store');
  const sessions = await h.prisma.androidSession.findMany({
    where: { userId: f.source.user.id },
  });
  expect(sessions).toHaveLength(1);
  expect(JSON.stringify(sessions)).not.toContain(result.accessToken);
  const row = await h.prisma.androidBindingRequest.findUniqueOrThrow({
    where: { id: f.started.bindingId },
  });
  expect(JSON.stringify(row)).not.toContain(f.code);
});

test('native bearer cannot become a Web session and a Web cookie cannot authorize native logout', async () => {
  const f = await approved();
  const token = data<AndroidTokenResponse>(await exchange(f)).accessToken;
  expect(
    (await http().get('/api/v1/me').set('Authorization', `Bearer ${token}`))
      .status,
  ).toBe(401);
  expect(
    (await http().get('/api/v1/me').set('Cookie', `jlpt_session=${token}`))
      .status,
  ).toBe(401);
  expect(
    (await http().post(`${path}/logout`).set('Cookie', f.cookie).send({}))
      .status,
  ).toBe(401);
  const loggedOut = await http()
    .post(`${path}/logout`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  expect(loggedOut.status).toBe(201);
  expect(
    (
      await http()
        .post(`${path}/logout`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
    ).status,
  ).toBe(401);
  expect((await http().get('/api/v1/me').set('Cookie', f.cookie)).status).toBe(
    200,
  );
});

test('Web logout revokes an approved but unexchanged binding, while a second device can still bind', async () => {
  const f = await approved();
  const device2 = await web.loginWithGoogle(f.profile);
  const response = await http()
    .post('/api/v1/auth/logout')
    .set('Cookie', f.cookie)
    .set('Origin', origin)
    .send({});
  expect(response.status).toBe(201);
  expect((await exchange(f)).status).toBe(401);
  expect(
    await h.prisma.androidSession.count({
      where: { userId: f.source.user.id },
    }),
  ).toBe(0);
  expect((await web.authenticate(device2.rawToken)).user.id).toBe(
    f.source.user.id,
  );
});

test('source lifetime bounds approval and token lifetime; concurrent logout leaves no authenticatable token', async () => {
  const f = await fixture();
  const expiresAt = new Date(Date.now() + 15_000);
  await h.prisma.authSession.update({
    where: { id: f.source.id },
    data: { expiresAt },
  });
  await h.prisma.androidBindingRequest.update({
    where: { id: f.started.bindingId },
    data: { expiresAt },
  });
  const approval = await auth.approve(
    f.started.bindingId,
    f.source.user.id,
    f.source.id,
  );
  const row = await h.prisma.androidBindingRequest.findUniqueOrThrow({
    where: { id: f.started.bindingId },
  });
  expect(row.codeExpiresAt!.getTime()).toBe(expiresAt.getTime());
  const code = new URL(approval.callbackUrl).searchParams.get('code')!;
  const token = await auth.exchange('android-test', code, f.verifier);
  expect(new Date(token.expiresAt).getTime()).toBe(expiresAt.getTime());
  const racing = await approved();
  const [attempt] = await Promise.allSettled([
    auth.exchange('android-test', racing.code, racing.verifier),
    web.logout(racing.login.rawToken),
  ]);
  if (attempt.status === 'fulfilled')
    await expect(
      auth.authenticate(`Bearer ${attempt.value.accessToken}`),
    ).rejects.toMatchObject({ response: { code: 'SESSION_EXPIRED' } });
  else
    expect(attempt.reason).toMatchObject({
      response: { code: 'SESSION_EXPIRED' },
    });
});

test('runtime feature/environment isolation rejects disabled, mismatched and encoded production database configurations', () => {
  const policy = app.get(AndroidPolicy);
  const cases = [
    { ANDROID_COMMERCE_ENABLED: false, code: 'ANDROID_COMMERCE_DISABLED' },
    { ANDROID_COMMERCE_ENABLED: 'false', code: 'ANDROID_COMMERCE_DISABLED' },
    {
      ANDROID_COMMERCE_ENVIRONMENT: 'live',
      code: 'ANDROID_BILLING_ENVIRONMENT_MISMATCH',
    },
    {
      DATABASE_URL: 'postgresql://localhost/%6alpt',
      code: 'ANDROID_TEST_DATABASE_FORBIDDEN',
    },
  ];
  for (const values of cases) {
    const previous = Object.keys(values)
      .filter((key) => key !== 'code')
      .map((key) => [key, config.get<unknown>(key)] as const);
    try {
      for (const [key, value] of Object.entries(values))
        if (key !== 'code') config.set(key, value);
      let caught: unknown;
      try {
        policy.assertEnabled();
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ response: { code: values.code } });
    } finally {
      for (const [key, value] of previous) config.set(key, value);
    }
  }
});

test('public binding endpoint has an enforced request limit without creating rejected rows', async () => {
  const before = await h.prisma.androidBindingRequest.count();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const response = await http()
      .post(`${path}/bindings`)
      .send({
        clientId: 'android-test',
        codeChallenge: digest(entropy()),
        state: entropy(),
      });
    statuses.push(response.status);
  }
  expect(statuses).toContain(429);
  expect(statuses.every((status) => status === 201 || status === 429)).toBe(
    true,
  );
  expect((await h.prisma.androidBindingRequest.count()) - before).toBe(
    statuses.filter((status) => status === 201).length,
  );
});
