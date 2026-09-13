import {
  generateKeyPairSync,
  randomUUID,
  randomBytes,
  createHash,
  sign,
} from 'node:crypto';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthService } from '../../src/auth/auth.service';
import { AndroidAuthService } from '../../src/android-commerce/android-auth.service';
import { AndroidCommerceModule } from '../../src/android-commerce/android-commerce.module';
import { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';
import { AdmobVerifier } from '../../src/android-commerce/admob-verifier';
import { GoogleGateway } from '../../src/android-commerce/google.gateway';
import { OriginGuard } from '../../src/common/origin.guard';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const data = <T>(r: request.Response) => (r.body as { data: T }).data;
const code = (r: request.Response) =>
  (r.body as { error: { code: string } }).error.code;
const root = '/api/v1/android/commerce';
let h: AcceptanceDatabase, app: NestExpressApplication, config: ConfigService;
const http = () => request(app.getHttpServer());
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
            FRONTEND_URL: 'https://f-commerce.example.test',
            SESSION_SECRET: 'f-commerce-isolated-session-secret-long',
            GOOGLE_CLIENT_ID: 'synthetic',
            GOOGLE_CLIENT_SECRET: 'synthetic',
            GOOGLE_CALLBACK_URL: 'https://f-commerce.example.test/callback',
            BILLING_ENVIRONMENT: 'test',
            ANDROID_COMMERCE_ENVIRONMENT: 'test',
            ANDROID_COMMERCE_ENABLED: true,
            ANDROID_GOOGLE_ENABLED: false,
            ANDROID_ADMOB_ENABLED: true,
            GOOGLE_PLAY_PACKAGE_NAME: 'com.meritledger.app.debug',
            GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
            ADMOB_REWARDED_AD_UNIT_ID: 'ca-app-pub-3940256099942544/5224354917',
            ADMOB_REWARD_ITEM: 'jlpt_task',
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
  app = module.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  config = app.get(ConfigService);
  await h.prisma.billingConfig.create({
    data: {
      androidRewardsEnabled: true,
      launchAt: new Date('2026-09-12T23:58:15.676Z'),
    },
  });
});
afterAll(async () => {
  await app?.close();
  await h?.stop();
});
afterEach(() => {
  jest.restoreAllMocks();
  config.set('ANDROID_COMMERCE_ENABLED', true);
  config.set('ANDROID_ADMOB_ENABLED', true);
});
async function identity() {
  const web = app.get(AuthService),
    auth = app.get(AndroidAuthService);
  const login = await web.loginWithGoogle({
    providerId: randomUUID(),
    email: `${randomUUID()}@example.test`,
    displayName: 'F native commerce',
  });
  const source = await web.authenticate(login.rawToken),
    verifier = randomBytes(32).toString('base64url');
  const start = await auth.start({
    clientId: 'android-test',
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    state: randomBytes(32).toString('base64url'),
  });
  const approval = await auth.approve(
    start.bindingId,
    source.user.id,
    source.id,
  );
  const token = await auth.exchange(
    'android-test',
    new URL(approval.callbackUrl).searchParams.get('code')!,
    verifier,
  );
  const session = await auth.authenticate(`Bearer ${token.accessToken}`);
  return {
    user: login.user,
    bearer: `Bearer ${token.accessToken}`,
    session: session.session,
    rawCookie: login.rawToken,
  };
}
function signed(raw: string, exactBytes = raw) {
  return `${raw}&signature=${sign('sha256', Buffer.from(exactBytes), { key: keys.privateKey, dsaEncoding: 'der' }).toString('base64url')}&key_id=1234`;
}
function trustedKeys() {
  return jest.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        keys: [
          {
            keyId: 1234,
            base64: keys.publicKey
              .export({ format: 'der', type: 'spki' })
              .toString('base64'),
          },
        ],
      }),
      { status: 200 },
    ),
  );
}
async function ticket() {
  const user = await identity();
  const reward = await app
    .get(AdmobRewardService)
    .create(user.user.id, randomUUID());
  const row = await h.prisma.rewardTicket.findUniqueOrThrow({
    where: { id: reward.ticketId },
  });
  const raw = (timestamp = Date.now(), transaction = randomUUID()) =>
    `ad_network=123&ad_unit=5224354917&custom_data=${reward.customData}&reward_amount=1&reward_item=jlpt_task&timestamp=${timestamp}&transaction_id=${transaction}&user_id=${reward.ssvUserId}`;
  return { ...user, reward, row, raw };
}

test('real commerce handlers enforce method-specific scopes before purchase or reward side effects', async () => {
  const f = await identity();
  const provider = jest.spyOn(app.get(GoogleGateway), 'purchase');
  await h.prisma.androidSession.update({
    where: { id: f.session.id },
    data: { scopes: ['commerce:read'] },
  });
  expect(
    (await http().get(`${root}/catalog`).set('Authorization', f.bearer)).status,
  ).toBe(200);
  for (const [path, body] of [
    [
      `${root}/google/purchases/verify`,
      { purchaseToken: 'untrusted', productId: 'jlpt_day_pass' },
    ],
    [`${root}/reward-tickets`, { requestKey: randomUUID() }],
  ] as const) {
    const response = await http()
      .post(path)
      .set('Authorization', f.bearer)
      .send(body);
    expect(response.status).toBe(403);
    expect(code(response)).toBe('ANDROID_SCOPE_REQUIRED');
  }
  expect(
    (
      await http()
        .get(`${root}/reward-tickets/missing`)
        .set('Authorization', f.bearer)
    ).status,
  ).toBe(403);
  expect(
    await h.prisma.rewardTicket.count({ where: { userId: f.user.id } }),
  ).toBe(0);
  expect(provider).not.toHaveBeenCalled();
  await h.prisma.androidSession.update({
    where: { id: f.session.id },
    data: { scopes: ['admob:reward'] },
  });
  expect(
    (await http().get(`${root}/catalog`).set('Authorization', f.bearer)).status,
  ).toBe(403);
  expect(
    (
      await http()
        .post(`${root}/reward-tickets`)
        .set('Authorization', f.bearer)
        .send({ requestKey: randomUUID() })
    ).status,
  ).toBe(201);
});

test('foreign ticket and order cursor are hidden and source logout revokes commerce access', async () => {
  const owner = await ticket(),
    other = await identity();
  expect(
    (
      await http()
        .get(`${root}/reward-tickets/${owner.reward.ticketId}`)
        .set('Authorization', other.bearer)
    ).status,
  ).toBe(404);
  const order = await h.prisma.paymentOrder.create({
    data: {
      userId: owner.user.id,
      provider: 'GOOGLE',
      environment: 'test',
      productCode: 'DAY_PASS',
      market: 'GLOBAL',
      currency: 'USD',
      amount: 99,
      durationSeconds: 86400,
      requestKey: randomUUID(),
      snapshot: { fixture: 'F independent cursor ownership' },
      status: 'PAID',
    },
  });
  expect(
    (
      await http()
        .get(`${root}/orders?cursor=${order.id}`)
        .set('Authorization', other.bearer)
    ).status,
  ).toBe(404);
  expect(
    data<unknown[]>(
      await http().get(`${root}/orders`).set('Authorization', other.bearer),
    ),
  ).toEqual([]);
  await app.get(AuthService).logout(owner.rawCookie);
  expect(
    (
      await http()
        .get(`${root}/entitlements`)
        .set('Authorization', owner.bearer)
    ).status,
  ).toBe(401);
});

test('official encoded-query convention is verified against explicitly chosen bytes through the real key decoder', async () => {
  const fetch = trustedKeys(),
    verifier = new AdmobVerifier();
  // Apache-2.0 Tink RewardedAdsVerifierTest.testShouldVerifyWithEncodedUrl convention.
  // https://github.com/tink-crypto/tink-java-apps/blob/main/rewardedads/src/test/java/com/google/crypto/tink/apps/rewardedads/RewardedAdsVerifierTest.java
  const raw = 'foo=hello%20world&bar=user%40gmail.com';
  expect(
    await verifier.verify(signed(raw, 'foo=hello world&bar=user@gmail.com')),
  ).toEqual({ foo: 'hello world', bar: 'user@gmail.com' });
  await expect(verifier.verify(signed(raw, raw))).rejects.toMatchObject({
    response: { code: 'INVALID_ADMOB_SIGNATURE' },
  });
  const escaped =
    'plus=a+b%2Bc&percent=%2525&unicode=%E6%97%A5%E6%9C%AC&amp=x%26y';
  expect(
    await verifier.verify(
      signed(escaped, 'plus=a+b+c&percent=%25&unicode=日本&amp=x&y'),
    ),
  ).toMatchObject({
    plus: 'a+b+c',
    percent: '%25',
    unicode: '日本',
    amp: 'x&y',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('actual raw-URL callback credits one task under eight concurrent replays and accepts a signed late reward after switches close', async () => {
  trustedKeys();
  const f = await ticket();
  const issued = new Date(Date.now() - 3600000),
    expires = new Date(issued.getTime() + 1200000);
  await h.prisma.rewardTicket.update({
    where: { id: f.reward.ticketId },
    data: { issuedAt: issued, expiresAt: expires },
  });
  config.set('ANDROID_COMMERCE_ENABLED', false);
  config.set('ANDROID_ADMOB_ENABLED', false);
  const raw = `${f.raw(issued.getTime() + 500000)}&note=a%2Bb%2525`;
  const query = signed(raw, raw.replace('note=a%2Bb%2525', 'note=a+b%25'));
  const responses = await Promise.all(
    Array.from({ length: 8 }, () => http().get(`${root}/admob/ssv?${query}`)),
  );
  expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
  expect(
    await h.prisma.quotaAccount.findUnique({ where: { userId: f.user.id } }),
  ).toMatchObject({ rewardBalance: 1 });
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: f.user.id } }),
  ).toBe(1);
  expect(
    await h.prisma.rewardTicket.findUnique({
      where: { id: f.reward.ticketId },
    }),
  ).toMatchObject({ status: 'REDEEMED' });
});

test('signed timestamp boundaries, duplicate security parameters and another ticket secret cannot award', async () => {
  trustedKeys();
  const f = await ticket();
  for (const time of [
    f.row.issuedAt.getTime() - 60001,
    f.row.expiresAt.getTime() + 60001,
    Math.floor(Date.now() / 1000),
  ])
    expect(
      (await http().get(`${root}/admob/ssv?${signed(f.raw(time))}`)).status,
    ).toBe(400);
  const duplicate = `${f.raw()}&reward_amount=1`;
  expect(
    (await http().get(`${root}/admob/ssv?${signed(duplicate)}`)).status,
  ).toBe(400);
  const foreign = await ticket();
  const tampered = f
    .raw()
    .replace(f.reward.customData, foreign.reward.customData);
  expect(
    (await http().get(`${root}/admob/ssv?${signed(tampered)}`)).status,
  ).toBe(400);
  expect(
    await h.prisma.rewardEvent.count({
      where: { userId: { in: [f.user.id, foreign.user.id] } },
    }),
  ).toBe(0);
});

test('verified foreign purchase never exposes its order or transfers membership to the caller', async () => {
  const owner = await identity(),
    foreign = await identity();
  const gateway = app.get(GoogleGateway);
  const account = await h.prisma.user.findUniqueOrThrow({
    where: { id: owner.user.id },
  });
  const purchaseToken = randomBytes(32).toString('base64url'),
    orderId = `GPA.${randomUUID()}`;
  jest.spyOn(gateway, 'purchase').mockResolvedValue({
    productLineItem: [
      {
        productId: 'jlpt_day_pass',
        productOfferDetails: {
          quantity: 1,
          purchaseOptionId: 'buy',
          consumptionState: 'CONSUMPTION_STATE_CONSUMED',
        },
      },
    ],
    purchaseStateContext: { purchaseState: 'PURCHASED' },
    testPurchaseContext: { fopType: 'TEST' },
    orderId,
    obfuscatedExternalAccountId: account.googlePlayAccountId!,
    purchaseCompletionTime: new Date().toISOString(),
  });
  jest.spyOn(gateway, 'order').mockResolvedValue({
    orderId,
    purchaseToken,
    state: 'PROCESSED',
    lastEventTime: new Date().toISOString(),
    createTime: new Date().toISOString(),
    total: { currencyCode: 'USD', units: '0', nanos: 990000000 },
    lineItems: [{ productId: 'jlpt_day_pass' }],
  });
  const consume = jest.spyOn(gateway, 'consume');
  const response = await http()
    .post(`${root}/google/purchases/verify`)
    .set('Authorization', foreign.bearer)
    .send({
      purchaseToken,
      productId: 'jlpt_day_pass',
      userId: foreign.user.id,
      amount: 0,
    });
  expect(response.status).toBe(409);
  expect(code(response)).toBe('GOOGLE_OWNER_MISMATCH');
  expect((response.body as { data?: unknown }).data).toBeUndefined();
  expect(
    await h.prisma.entitlementGrant.count({
      where: { userId: foreign.user.id },
    }),
  ).toBe(0);
  expect(
    await h.prisma.entitlementGrant.count({ where: { userId: owner.user.id } }),
  ).toBe(1);
  const restored = await http()
    .post(`${root}/google/purchases/verify`)
    .set('Authorization', owner.bearer)
    .send({ purchaseToken, productId: 'jlpt_day_pass' });
  expect(restored.status).toBe(201);
  expect(data<{ status: string }>(restored).status).toBe('VERIFIED');
  expect(consume).not.toHaveBeenCalled();
  expect(
    await h.prisma.paymentOrder.count({ where: { userId: owner.user.id } }),
  ).toBe(1);
});

test('same signed transaction racing across different users can credit only one account', async () => {
  trustedKeys();
  const first = await ticket(),
    second = await ticket();
  const transaction = randomUUID(),
    service = app.get(AdmobRewardService);
  const outcomes = await Promise.allSettled([
    service.receive(signed(first.raw(Date.now(), transaction))),
    service.receive(signed(second.raw(Date.now(), transaction))),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === 'rejected')).toHaveLength(1);
  const users = [first.user.id, second.user.id];
  const balances = await h.prisma.quotaAccount.findMany({
    where: { userId: { in: users } },
  });
  expect(
    balances.reduce((sum, account) => sum + account.rewardBalance, 0),
  ).toBe(1);
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: { in: users } } }),
  ).toBe(1);
  expect(
    await h.prisma.rewardTicket.count({
      where: { userId: { in: users }, status: 'REDEEMED' },
    }),
  ).toBe(1);
});
