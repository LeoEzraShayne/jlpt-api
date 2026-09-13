/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP DTOs are asserted against guarded DB state. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { AndroidCommerceModule } from '../../src/android-commerce/android-commerce.module';
import { OriginGuard } from '../../src/common/origin.guard';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
let h: AcceptanceDatabase;
let app: NestExpressApplication;
const origin = 'https://example.test';
beforeAll(async () => {
  h = await acceptanceDatabase();
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
            SESSION_SECRET: 'android-local-only-fixture-session-secret',
            FRONTEND_URL: origin,
            GOOGLE_CLIENT_ID: 'fixture',
            GOOGLE_CLIENT_SECRET: 'fixture',
            GOOGLE_CALLBACK_URL: `${origin}/callback`,
            BILLING_ENVIRONMENT: 'test',
            ANDROID_COMMERCE_ENABLED: true,
            ANDROID_COMMERCE_ENVIRONMENT: 'test',
            ANDROID_GOOGLE_ENABLED: false,
            ANDROID_ADMOB_ENABLED: false,
          }),
        ],
      }),
      DatabaseModule,
      AndroidCommerceModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
  })
    .overrideProvider(PrismaService)
    .useValue(h.prisma)
    .compile();
  app = module.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
});
afterAll(async () => {
  await app?.close();
  await h?.stop();
});
const http = () => request(app.getHttpServer());
test('only exact native POST paths bypass Origin; approval needs cookie and valid Origin', async () => {
  const web = await app.get(AuthService).loginWithGoogle({
    providerId: randomUUID(),
    email: `${randomUUID()}@example.test`,
    displayName: 'Native HTTP',
  });
  const cookie = `jlpt_session=${web.rawToken}`;
  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const start = await http()
    .post('/api/v1/android/auth/bindings')
    .send({
      clientId: 'android-test',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
      state,
    })
    .expect(201);
  const id = start.body.data.bindingId as string;
  await http().get(`/api/v1/android/auth/bindings/${id}`).expect(401);
  await http()
    .get(`/api/v1/android/auth/bindings/${id}`)
    .set('Cookie', cookie)
    .expect(200);
  await http()
    .post(`/api/v1/android/auth/bindings/${id}/approve`)
    .set('Cookie', cookie)
    .send({})
    .expect(403);
  await http().post('/api/v1/android/auth/bindings/').send({}).expect(403);
  const approval = await http()
    .post(`/api/v1/android/auth/bindings/${id}/approve`)
    .set('Cookie', cookie)
    .set('Origin', origin)
    .send({})
    .expect(201);
  expect(approval.headers['cache-control']).toBe('no-store');
  const callback = new URL(approval.body.data.callbackUrl as string);
  expect(callback.pathname).toBe('/android/callback/test');
  expect(callback.searchParams.get('state')).toBe(state);
  const exchanged = await http()
    .post('/api/v1/android/auth/exchange')
    .send({
      clientId: 'android-test',
      code: callback.searchParams.get('code'),
      codeVerifier: verifier,
    })
    .expect(201);
  const bearer = `Bearer ${exchanged.body.data.accessToken as string}`;
  await http()
    .get('/api/v1/android/commerce/catalog')
    .set('Cookie', cookie)
    .expect(401);
  const catalog = await http()
    .get('/api/v1/android/commerce/catalog')
    .set('Authorization', bearer)
    .expect(200);
  expect(catalog.body.data.salesEnabled).toBe(false);
  expect(catalog.body.data.products).toHaveLength(2);
  await http()
    .post('/api/v1/android/commerce/reward-tickets')
    .set('Authorization', bearer)
    .send({ requestKey: randomUUID() })
    .expect(503);
  await http()
    .post('/api/v1/android/commerce/google/rtdn')
    .send({})
    .expect(401);
  await http()
    .post('/api/v1/android/auth/logout')
    .set('Authorization', bearer)
    .send({})
    .expect(201);
  await http()
    .get('/api/v1/android/commerce/catalog')
    .set('Authorization', bearer)
    .expect(401);
});
test('disabled commerce exposes no native binding or bearer access', async () => {
  app.get(ConfigService).set('ANDROID_COMMERCE_ENABLED', false);
  try {
    await http()
      .post('/api/v1/android/auth/bindings')
      .send({
        clientId: 'android-test',
        codeChallenge: randomBytes(32).toString('base64url'),
        state: randomBytes(32).toString('base64url'),
      })
      .expect(503);
  } finally {
    app.get(ConfigService).set('ANDROID_COMMERCE_ENABLED', true);
  }
});
