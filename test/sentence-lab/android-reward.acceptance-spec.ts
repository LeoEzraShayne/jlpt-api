import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import {
  AdmobVerifier,
  parseSsv,
} from '../../src/android-commerce/admob-verifier';
import { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';
let h: AcceptanceDatabase;
const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
beforeAll(async () => {
  h = await acceptanceDatabase();
});
afterAll(async () => {
  await h?.stop();
});
afterEach(() => jest.restoreAllMocks());
function signed(raw: string) {
  const signature = sign('sha256', Buffer.from(decodeURIComponent(raw)), {
    key: keys.privateKey,
    dsaEncoding: 'der',
  }).toString('base64url');
  return `${raw}&signature=${signature}&key_id=1234`;
}
async function fixture() {
  const config = new ConfigService({
    ANDROID_COMMERCE_ENABLED: true,
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    BILLING_ENVIRONMENT: 'test',
    DATABASE_URL: h.connectionString,
    ANDROID_ADMOB_ENABLED: true,
    ADMOB_REWARDED_AD_UNIT_ID: 'ca-app-pub-3940256099942544/5224354917',
    ADMOB_REWARD_ITEM: 'jlpt_task',
  });
  await h.prisma.billingConfig.upsert({
    where: { id: 'default' },
    create: { androidRewardsEnabled: true },
    update: { androidRewardsEnabled: true },
  });
  const user = await h.prisma.user.create({
    data: {
      email: `${randomUUID()}@example.test`,
      displayName: 'Reward fixture',
    },
  });
  const policy = new AndroidPolicy(config),
    verifier = new AdmobVerifier();
  jest.spyOn(verifier, 'key').mockResolvedValue(keys.publicKey);
  const service = new AdmobRewardService(
    h.prisma as PrismaService,
    policy,
    new EntitlementService(config),
    verifier,
  );
  const requestKey = randomUUID();
  const ticket = await service.create(user.id, requestKey);
  const transaction = randomUUID();
  const query = (time = Date.now(), txn = transaction) =>
    signed(
      `ad_network=123&ad_unit=5224354917&custom_data=${ticket.customData}&reward_amount=1&reward_item=jlpt_task&timestamp=${time}&transaction_id=${txn}&user_id=${ticket.ssvUserId}`,
    );
  return {
    config,
    policy,
    verifier,
    user,
    service,
    ticket,
    query,
    requestKey,
    transaction,
  };
}
test('real ECDSA signed concurrent callbacks credit one task and status confirms it', async () => {
  const f = await fixture();
  const callback = f.query();
  await Promise.all(
    Array.from({ length: 5 }, () => f.service.receive(callback)),
  );
  expect(await f.service.status(f.user.id, f.ticket.ticketId)).toMatchObject({
    status: 'REDEEMED',
    rewardBalance: 1,
  });
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: f.user.id } }),
  ).toBe(1);
  await expect(
    f.service.receive(f.query(Date.now(), randomUUID())),
  ).rejects.toMatchObject({ response: { code: 'REWARD_ALREADY_CLAIMED' } });
});
test('expired UI does not erase legitimately earned late delivery or a reward earned before membership', async () => {
  const f = await fixture();
  await h.prisma.rewardTicket.update({
    where: { id: f.ticket.ticketId },
    data: {
      issuedAt: new Date(Date.now() - 3600000),
      expiresAt: new Date(Date.now() - 2400000),
    },
  });
  expect((await f.service.status(f.user.id, f.ticket.ticketId)).status).toBe(
    'EXPIRED',
  );
  await h.prisma.entitlementGrant.create({
    data: {
      userId: f.user.id,
      source: 'STRIPE_TEST',
      sourceKey: randomUUID(),
      durationSeconds: 86400,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { androidRewardsEnabled: false },
  });
  f.config.set('ANDROID_ADMOB_ENABLED', false);
  await f.service.receive(f.query(Date.now() - 3000000));
  expect(
    (await f.service.status(f.user.id, f.ticket.ticketId)).rewardBalance,
  ).toBe(1);
});
test('wrong numeric unit, owner, item, seconds timestamp and forged signature cannot award', async () => {
  const f = await fixture();
  const raw = f.query().split('&signature=')[0];
  for (const invalid of [
    raw.replace('ad_unit=5224354917', 'ad_unit=999'),
    raw.replace(`user_id=${f.ticket.ssvUserId}`, 'user_id=someone'),
    raw.replace('reward_item=jlpt_task', 'reward_item=coin'),
    raw.replace(/timestamp=\d+/, `timestamp=${Math.floor(Date.now() / 1000)}`),
  ]) {
    await expect(f.service.receive(signed(invalid))).rejects.toMatchObject({
      response: { code: 'INVALID_ADMOB_REWARD' },
    });
  }
  await expect(
    f.service.receive(f.query().replace('reward_amount=1', 'reward_amount=2')),
  ).rejects.toMatchObject({ response: { code: 'INVALID_ADMOB_SIGNATURE' } });
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: f.user.id } }),
  ).toBe(0);
});
test('lost ticket response can restart without blocking older earned ticket and members cannot start ads', async () => {
  const f = await fixture();
  await expect(f.service.create(f.user.id, f.requestKey)).rejects.toMatchObject(
    { response: { code: 'TICKET_RESTART_REQUIRED' } },
  );
  await f.service.create(f.user.id, randomUUID());
  await f.service.receive(f.query());
  await h.prisma.entitlementGrant.create({
    data: {
      userId: f.user.id,
      source: 'STRIPE_TEST',
      sourceKey: randomUUID(),
      durationSeconds: 86400,
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 86400000),
    },
  });
  await expect(f.service.create(f.user.id, randomUUID())).rejects.toMatchObject(
    { response: { code: 'MEMBER_ADS_DISABLED' } },
  );
});
test('test callbacks are refused by a live service and even test configuration cannot touch production jlpt DB', async () => {
  const f = await fixture();
  f.config.set('ANDROID_COMMERCE_ENVIRONMENT', 'live');
  f.config.set('BILLING_ENVIRONMENT', 'live');
  await expect(f.service.receive(f.query())).rejects.toMatchObject({
    response: { code: 'INVALID_ADMOB_REWARD' },
  });
  f.config.set('ANDROID_COMMERCE_ENVIRONMENT', 'test');
  f.config.set('BILLING_ENVIRONMENT', 'test');
  f.config.set('DATABASE_URL', 'postgresql://localhost/jlpt');
  await expect(f.service.receive(f.query())).rejects.toMatchObject({
    response: { code: 'ANDROID_TEST_DATABASE_FORBIDDEN' },
  });
  expect(
    await h.prisma.rewardEvent.count({ where: { userId: f.user.id } }),
  ).toBe(0);
});
test('official Tink URI.getQuery encoding semantics preserve plus, percent, separators and Unicode', async () => {
  const verifier = new AdmobVerifier();
  jest.spyOn(verifier, 'key').mockResolvedValue(keys.publicKey);
  // Official Tink encoded vector is foo=hello%20world&bar=user%40gmail.com.
  // Project extends that convention with escaped &, +, %, and UTF-8; no form parser.
  const raw =
    'foo=hello%20world&bar=user%40gmail.com&plus=a+b%2Bc&percent=%2525&amp=a%26b&utf8=%E6%97%A5%E6%9C%AC';
  expect((await verifier.verify(signed(raw))).plus).toBe('a+b+c');
  expect(parseSsv(signed(raw)).bytes.toString()).toBe(
    'foo=hello world&bar=user@gmail.com&plus=a+b+c&percent=%25&amp=a&b&utf8=日本',
  );
  for (const query of [
    signed('a=1&a=2'),
    signed('a=1&b=x%26a=2'),
    signed('a=1') + '&after=1',
    signed('a=1').replace('key_id=1234', 'key_id=bad'),
  ])
    await expect(verifier.verify(query)).rejects.toMatchObject({
      response: { code: 'INVALID_ADMOB_SIGNATURE' },
    });
  jest.spyOn(verifier, 'key').mockRejectedValue(new Error('unknown key'));
  await expect(verifier.verify(signed('a=1'))).rejects.toMatchObject({
    response: { code: 'INVALID_ADMOB_SIGNATURE' },
  });
});
