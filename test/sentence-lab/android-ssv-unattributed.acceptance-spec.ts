import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import type { Server } from 'node:http';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { AdmobVerifier } from '../../src/android-commerce/admob-verifier';
import { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';
import { AndroidCallbacksController } from '../../src/android-commerce/android-commerce.controller';
import { GoogleNotificationsService } from '../../src/android-commerce/google-notifications.service';

let h: AcceptanceDatabase;
let app: INestApplication;
let config: ConfigService;
let service: AdmobRewardService;
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const path = '/android/commerce/admob/ssv';
const unsigned = () =>
  `ad_network=123&ad_unit=1234567890&reward_amount=5&reward_item=coins&timestamp=${Date.now()}&transaction_id=${randomUUID()}`;
function signed(raw: string) {
  const signature = sign('sha256', Buffer.from(decodeURIComponent(raw)), {
    key: keys.privateKey,
    dsaEncoding: 'der',
  }).toString('base64url');
  return `${raw}&signature=${signature}&key_id=1234`;
}
const http = (query: string) =>
  request(app.getHttpServer() as Server).get(`${path}?${query}`);
const snapshot = async () => ({
  tickets: await h.prisma.rewardTicket.findMany({ orderBy: { id: 'asc' } }),
  events: await h.prisma.rewardEvent.findMany({ orderBy: { id: 'asc' } }),
  balances: await h.prisma.quotaAccount.findMany({
    orderBy: { userId: 'asc' },
  }),
  orders: await h.prisma.paymentOrder.count(),
  grants: await h.prisma.entitlementGrant.count(),
  users: await h.prisma.user.count(),
});
beforeAll(async () => {
  h = await acceptanceDatabase();
  config = new ConfigService({
    DATABASE_URL: h.connectionString,
    BILLING_ENVIRONMENT: 'live',
    ANDROID_COMMERCE_ENVIRONMENT: 'live',
    ANDROID_COMMERCE_ENABLED: false,
    ANDROID_ADMOB_ENABLED: false,
    ADMOB_REWARDED_AD_UNIT_ID: 'ca-app-pub-1111111111111111/2222222222',
  });
  const verifier = new AdmobVerifier();
  // Only replace the public-key download; raw parsing and real ECDSA still run.
  jest.spyOn(verifier, 'key').mockResolvedValue(keys.publicKey);
  service = new AdmobRewardService(
    h.prisma as PrismaService,
    new AndroidPolicy(config),
    new EntitlementService(config),
    verifier,
  );
  const module = await Test.createTestingModule({
    controllers: [AndroidCallbacksController],
    providers: [
      { provide: AdmobRewardService, useValue: service },
      { provide: GoogleNotificationsService, useValue: {} },
    ],
  }).compile();
  app = module.createNestApplication();
  // Stable loopback listener prevents supertest's per-request close racing replays.
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  jest.restoreAllMocks();
  await app?.close();
  await h?.stop();
});

test('signed absent custom data ACKs even with live gates closed; concurrent replay performs no DB work', async () => {
  const before = await snapshot();
  const lookup = jest.spyOn(h.prisma.rewardTicket, 'findUnique');
  const transaction = jest.spyOn(h.prisma, '$transaction');
  const query = signed(unsigned());
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => http(query)),
  );
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      received: true,
      ignored: 'NO_REWARD_TICKET',
    });
  }
  expect(lookup).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  lookup.mockRestore();
  transaction.mockRestore();
  expect(await snapshot()).toEqual(before);
});

test('no signature, tampering, removed signed ticket and ambiguous encodings never become ACKs', async () => {
  const before = await snapshot();
  const raw = unsigned();
  const callback = signed(raw);
  const queries = [
    raw,
    callback.replace('reward_amount=5', 'reward_amount=6'),
    signed(`${raw}&custom_data=${'a'.repeat(43)}`).replace(
      /&custom_data=[^&]+/,
      '',
    ),
    signed(`${raw}&custom_data=&custom_data=`),
    signed(`${raw}&custom%5Fdata=`),
    callback.replace('key_id=1234', 'key_id=1%253234'),
  ];
  for (const query of queries) {
    const response = await http(query);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_ADMOB_SIGNATURE' });
  }
  expect(await snapshot()).toEqual(before);
});

test.each(['', 'malformed', 'a'.repeat(43)])(
  'present custom data stays subject to ticket validation: %s',
  async (customData) => {
    const before = await snapshot();
    const raw = unsigned().replace('reward_amount=5', 'reward_amount=1');
    const response = await http(signed(`${raw}&custom_data=${customData}`));
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ code: 'INVALID_ADMOB_REWARD' });
    expect(await snapshot()).toEqual(before);
  },
);

test('an alias without a ticket cannot redeem; normal signed ticket still rewards exactly once', async () => {
  config.set('ANDROID_COMMERCE_ENABLED', true);
  config.set('ANDROID_ADMOB_ENABLED', true);
  await h.prisma.billingConfig.create({
    data: { androidRewardsEnabled: true },
  });
  const user = await h.prisma.user.create({
    data: { email: `${randomUUID()}@example.test`, displayName: 'SSV fixture' },
  });
  const ticket = await service.create(user.id, randomUUID());
  const raw = `ad_unit=2222222222&reward_amount=1&reward_item=jlpt_task&timestamp=${Date.now()}&transaction_id=${randomUUID()}&user_id=${ticket.ssvUserId}`;
  const before = await snapshot();
  await http(signed(raw)).expect(200, {
    received: true,
    ignored: 'NO_REWARD_TICKET',
  });
  expect(await snapshot()).toEqual(before);
  const query = signed(`${raw}&custom_data=${ticket.customData}`);
  const responses = await Promise.all(
    Array.from({ length: 4 }, () => http(query)),
  );
  expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
  expect(await service.status(user.id, ticket.ticketId)).toMatchObject({
    status: 'REDEEMED',
    rewardBalance: 1,
  });
  expect(await h.prisma.rewardEvent.count({ where: { userId: user.id } })).toBe(
    1,
  );
});
