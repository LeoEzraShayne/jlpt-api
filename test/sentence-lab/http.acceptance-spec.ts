/* eslint-disable @typescript-eslint/no-unsafe-member-access -- HTTP JSON is checked against the database and explicit expected values. */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import Stripe from 'stripe';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthModule } from '../../src/auth/auth.module';
import { AuthService } from '../../src/auth/auth.service';
import { BillingModule } from '../../src/billing/billing.module';
import { UsersModule } from '../../src/users/users.module';
import { StudySessionsModule } from '../../src/study-sessions/study-sessions.module';
import { VocabularyLearningModule } from '../../src/vocabulary-learning/vocabulary-learning.module';
import { OriginGuard } from '../../src/common/origin.guard';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
let h: AcceptanceDatabase;
let app: NestExpressApplication;
const origin = 'https://example.test';
const webhookSecret = 'whsec_f_http_acceptance_fixture_only';
const sdk = new Stripe('sk_test_f_http_acceptance_fixture_only');
const http = () => request(app.getHttpServer());
const route = (path: string) => `/api/v1${path}`;
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
            SESSION_SECRET: 'f-local-only-fixture-session-secret',
            FRONTEND_URL: origin,
            GOOGLE_CLIENT_ID: 'f-local-only',
            GOOGLE_CLIENT_SECRET: 'f-local-only',
            GOOGLE_CALLBACK_URL: `${origin}/callback`,
            BILLING_ENVIRONMENT: 'test',
            STRIPE_SECRET_KEY: 'sk_test_f_http_acceptance_fixture_only',
            STRIPE_WEBHOOK_SECRET: webhookSecret,
            AI_WORKER_ENABLED: false,
            REVIEW_ALGORITHM_MODE: 'adaptive',
            REVIEW_ALGORITHM_ROLLOUT_PERCENT: 100,
          }),
        ],
      }),
      DatabaseModule,
      AuthModule,
      BillingModule,
      UsersModule,
      StudySessionsModule,
      VocabularyLearningModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: OriginGuard }],
  })
    .overrideProvider(PrismaService)
    .useValue(h.prisma)
    .compile();
  // Match production bootstrap: rawBody option precedes explicit JSON parser.
  app = module.createNestApplication<NestExpressApplication>({ rawBody: true });
  app.setGlobalPrefix('api/v1');
  app.useBodyParser('json', { limit: '2mb' });
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  for (let i = 0; i < 3; i++)
    await h.prisma.grammarPoint.create({
      data: {
        id: `f-http-grammar-${i}`,
        title: 'ながら',
        level: 'N2',
        chineseExplanation: '同时进行两个动作',
        sourceDataset: 'f-http-fixture',
        sourceOrdinal: i,
        sourceHash: `f-http-${i}`,
        sortOrder: i,
      },
    });
});
afterAll(async () => {
  await app?.close();
  await h?.stop();
});
async function login() {
  const name = randomUUID();
  const result = await app.get(AuthService).loginWithGoogle({
    providerId: name,
    email: `${name}@example.test`,
    displayName: 'F HTTP',
  });
  await h.prisma.user.update({
    where: { id: result.user.id },
    data: { learningV2Enabled: true },
  });
  return { user: result.user, cookie: `jlpt_session=${result.rawToken}` };
}
function signed(raw: string) {
  return sdk.webhooks.generateTestHeaderString({
    payload: raw,
    secret: webhookSecret,
  });
}

test('production OriginGuard protects billing writes while exact signed webhook accepts absent browser origin', async () => {
  const u = await login();
  const payload = {
    productCode: 'DAY_PASS',
    market: 'GLOBAL',
    requestKey: randomUUID(),
    locale: 'en',
  };
  for (const attackerOrigin of ['', 'https://attacker.example.test']) {
    const denied = await http()
      .post(route('/billing/checkout'))
      .set('Cookie', u.cookie)
      .set('Origin', attackerOrigin)
      .send(payload)
      .expect(403);
    expect(denied.body.error.code).toBe('INVALID_ORIGIN');
  }
  const authRequired = await http()
    .post(route('/billing/checkout'))
    .set('Origin', origin)
    .send(payload)
    .expect(401);
  expect(authRequired.body.error.code).toBe('AUTH_REQUIRED');
  await http()
    .post(route('/billing/checkout'))
    .set('Origin', origin)
    .set('Cookie', u.cookie)
    .send(payload)
    .expect(503);
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: u.user.id } }),
  ).toBe(0);
  // Express accepts a trailing slash route, but only the exact callback is exempt.
  await http().post(route('/billing/webhooks/stripe/')).send({}).expect(403);
  await http().post(route('/auth/logout')).send({}).expect(403);
  const raw = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: 'product.updated',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: 'prod_unrelated_fixture' } },
  });
  const response = await http()
    .post(route('/billing/webhooks/stripe'))
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signed(raw))
    .send(raw)
    .expect(201);
  expect(response.body.received).toBe(true);
});

test('HTTP raw-body signature validation preserves exact bytes and rejects equivalent reserialized JSON', async () => {
  const eventId = `evt_${randomUUID()}`;
  const raw = `{\n  "id": "${eventId}", "type": "product.updated", "created": ${Math.floor(Date.now() / 1000)}, "livemode": false, "data": {"object": {"id": "prod_fixture"}}\n}`;
  const signature = signed(raw);
  await http()
    .post(route('/billing/webhooks/stripe'))
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(raw)
    .expect(201);
  const tampered = await http()
    .post(route('/billing/webhooks/stripe'))
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(JSON.stringify(JSON.parse(raw) as unknown))
    .expect(400);
  expect(tampered.body.error.code).toBe('INVALID_STRIPE_SIGNATURE');
  await http()
    .post(route('/billing/webhooks/stripe'))
    .send({ id: eventId })
    .expect(400);
  const live = JSON.stringify({
    id: `evt_${randomUUID()}`,
    type: 'product.updated',
    created: Math.floor(Date.now() / 1000),
    livemode: true,
    data: { object: { id: 'prod_fixture' } },
  });
  await http()
    .post(route('/billing/webhooks/stripe'))
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signed(live))
    .send(live)
    .expect(400);
  expect(await h.prisma.billingEvent.count({ where: { eventId } })).toBe(1);
});

test('HTTP membership/orders need a session and another account cannot read an order or use its cursor', async () => {
  const a = await login();
  const b = await login();
  for (const path of ['/me/entitlements', '/billing/orders'])
    await http().get(route(path)).expect(401);
  const order = await h.prisma.paymentOrder.create({
    data: {
      userId: a.user.id,
      provider: 'STRIPE',
      productCode: 'DAY_PASS',
      market: 'GLOBAL',
      currency: 'USD',
      amount: 99,
      durationSeconds: 86400,
      requestKey: randomUUID(),
      snapshot: {},
    },
  });
  await http()
    .get(route(`/billing/orders/${order.id}`))
    .set('Cookie', a.cookie)
    .expect(200);
  await http()
    .get(route(`/billing/orders/${order.id}`))
    .set('Cookie', b.cookie)
    .expect(404);
  await http()
    .get(route(`/billing/orders?cursor=${order.id}`))
    .set('Cookie', b.cookie)
    .expect(404);
  const own = await http()
    .get(route('/billing/orders'))
    .set('Cookie', b.cookie)
    .expect(200);
  expect(own.body.data).toEqual([]);
});

async function word() {
  return h.prisma.vocabularyEntry.create({
    data: {
      fingerprint: randomUUID(),
      word: '報告',
      reading: 'ほうこく',
      senseKey: 'report',
      partOfSpeech: ['noun'],
      glosses: [{ language: 'eng', text: 'report' }],
      sourceName: 'F HTTP',
      sourceVersion: '1',
      provenance: {},
      validationStatus: 'VALIDATED',
    },
  });
}

test('preference changes affect future grammar/vocabulary sessions while existing snapshots retain English', async () => {
  const u = await login();
  const mutate = (path: string, data: object) =>
    http()
      .put(route(path))
      .set('Cookie', u.cookie)
      .set('Origin', origin)
      .send(data);
  await mutate('/me/preferences', {
    uiLocale: 'zh',
    explanationLocale: 'en',
  }).expect(200);
  const firstResponse = await http()
    .post(route('/study-sessions'))
    .set('Cookie', u.cookie)
    .set('Origin', origin)
    .send({ grammarId: 'f-http-grammar-0', mode: 'PRACTICE' })
    .expect(201);
  const grammarId = firstResponse.body.data.session.id as string;
  const w = await word();
  await http()
    .patch(route(`/vocabulary/${w.id}/learning`))
    .set('Cookie', u.cookie)
    .set('Origin', origin)
    .send({ action: 'PRACTICE' })
    .expect(200);
  const vocabularyResponse = await http()
    .post(route('/vocabulary-practices'))
    .set('Cookie', u.cookie)
    .set('Origin', origin)
    .send({ vocabularyId: w.id })
    .expect(201);
  const practiceId = vocabularyResponse.body.data.id as string;
  await mutate('/me/preferences', {
    uiLocale: 'en',
    explanationLocale: 'zh',
  }).expect(200);
  const me = await http().get(route('/me')).set('Cookie', u.cookie).expect(200);
  expect(me.body.data).toMatchObject({
    uiLocale: 'en',
    explanationLocale: 'zh',
  });
  const originalGrammar = await http()
    .get(route(`/study-sessions/${grammarId}`))
    .set('Cookie', u.cookie)
    .expect(200);
  expect(originalGrammar.body.data.explanationLocale).toBe('en');
  expect(originalGrammar.body.data.trainingContext.explanationLocale).toBe(
    'en',
  );
  expect(originalGrammar.body.data.grammar.localized.requestedLocale).toBe(
    'en',
  );
  const originalVocabulary = await http()
    .get(route(`/vocabulary-practices/${practiceId}`))
    .set('Cookie', u.cookie)
    .expect(200);
  expect(originalVocabulary.body.data.explanationLocale).toBe('en');
  expect(
    (
      await h.prisma.vocabularyPractice.findUniqueOrThrow({
        where: { id: practiceId },
      })
    ).explanationLocale,
  ).toBe('en');
  const next = await http()
    .post(route('/study-sessions'))
    .set('Cookie', u.cookie)
    .set('Origin', origin)
    .send({ grammarId: 'f-http-grammar-1', mode: 'PRACTICE' })
    .expect(201);
  expect(next.body.data.session.explanationLocale).toBe('zh');
  await mutate('/me/preferences', { explanationLocale: 'ja' }).expect(400);
});
