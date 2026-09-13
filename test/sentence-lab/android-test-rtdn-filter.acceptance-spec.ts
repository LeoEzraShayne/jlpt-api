import { ConfigService } from '@nestjs/config';
import { AndroidTestRtdnFilter } from './android-test-rtdn-filter';
import type { PlayPurchase } from '../../src/android-commerce/google.gateway';

const config = new ConfigService({
  GOOGLE_RTDN_SUBSCRIPTION: 'projects/test/subscriptions/test',
});
function envelope(fields: object) {
  return {
    subscription: config.get<string>('GOOGLE_RTDN_SUBSCRIPTION'),
    message: {
      messageId: 'fixture',
      data: Buffer.from(
        JSON.stringify({
          packageName: 'com.meritledger.app',
          eventTimeMillis: '1',
          ...fields,
        }),
      ).toString('base64'),
    },
  };
}
function fixture() {
  const purchase: PlayPurchase = {
    productLineItem: [{ productId: 'jlpt_day_pass' }],
    purchaseStateContext: { purchaseState: 'PENDING' },
    testPurchaseContext: {},
  };
  const google = {
    verifyPush: jest.fn().mockResolvedValue(undefined),
    purchase: jest.fn().mockResolvedValue(purchase),
  };
  return {
    purchase,
    google,
    filter: new AndroidTestRtdnFilter(config, google),
  };
}
const hint = {
  oneTimeProductNotification: {
    sku: 'jlpt_day_pass',
    purchaseToken: 'fixture-token',
  },
};

test('real test context forwards pending/unowned purchases and voided hints without account assumptions', async () => {
  const f = fixture();
  expect(await f.filter.decide('Bearer fixture', envelope(hint))).toBe(
    'forward',
  );
  expect(
    await f.filter.decide(
      'Bearer fixture',
      envelope({
        voidedPurchaseNotification: { purchaseToken: 'fixture-token' },
      }),
    ),
  ).toBe('forward');
  expect(f.google.purchase).toHaveBeenCalledTimes(2);
});
test('authenticated legacy products, subscriptions and verified live purchases are filtered before storage', async () => {
  const f = fixture();
  expect(
    await f.filter.decide(
      'Bearer fixture',
      envelope({
        oneTimeProductNotification: {
          sku: 'ml_pro_lifetime',
          purchaseToken: 'old',
        },
      }),
    ),
  ).toBe('filtered');
  expect(
    await f.filter.decide(
      'Bearer fixture',
      envelope({ subscriptionNotification: { purchaseToken: 'old' } }),
    ),
  ).toBe('filtered');
  expect(f.google.purchase).not.toHaveBeenCalled();
  delete f.purchase.testPurchaseContext;
  expect(await f.filter.decide('Bearer fixture', envelope(hint))).toBe(
    'filtered',
  );
});
test('provider failure is not treated as filtered success, and bad OIDC/subscription fail closed', async () => {
  const f = fixture();
  f.google.purchase.mockRejectedValue(new Error('unavailable'));
  await expect(
    f.filter.decide('Bearer fixture', envelope(hint)),
  ).rejects.toThrow('unavailable');
  const wrong = { ...envelope(hint), subscription: 'wrong' };
  await expect(f.filter.decide('Bearer fixture', wrong)).rejects.toMatchObject({
    response: { code: 'INVALID_RTDN_ENVELOPE' },
  });
  f.google.verifyPush.mockRejectedValue(new Error('bad oidc'));
  await expect(f.filter.decide(undefined, envelope(hint))).rejects.toThrow(
    'bad oidc',
  );
});
