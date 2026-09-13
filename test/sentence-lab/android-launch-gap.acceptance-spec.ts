import { ConfigService } from '@nestjs/config';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { freezeDate } from '../learning-v2/review-fixtures';
import { AndroidCommerceController } from '../../src/android-commerce/android-commerce.controller';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { catalogFor } from '../../src/billing/billing.policy';
import type { PrismaService } from '../../src/database/prisma.service';
import type { QuotaService } from '../../src/billing/quota.service';
import type { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import type { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';

const launchAt = new Date('2026-09-12T23:58:15.676Z');
const launchEndsAt = '2027-03-12T23:58:15.676Z';
let h: AcceptanceDatabase;
let controller: AndroidCommerceController;
beforeAll(async () => {
  h = await acceptanceDatabase();
  await h.prisma.billingConfig.create({
    data: { launchAt, salesEnabled: true, androidSalesEnabled: true },
  });
  // Catalog reads the real isolated DB; mutation services are never invoked.
  controller = new AndroidCommerceController(
    h.prisma as unknown as PrismaService,
    new AndroidPolicy(new ConfigService({ ANDROID_GOOGLE_ENABLED: true })),
    {} as QuotaService,
    {} as GooglePurchaseService,
    {} as AdmobRewardService,
  );
});
afterEach(() => jest.useRealTimers());
afterAll(async () => h?.stop());

test.each([
  ['2027-03-12T23:57:59.999Z', 'launch-64', 6400],
  ['2027-03-12T23:58:00.000Z', 'paused', 6400],
  ['2027-03-12T23:58:15.675Z', 'paused', 6400],
  ['2027-03-12T23:58:15.676Z', null, 9900],
])(
  'native year availability at %s preserves the Web clock',
  async (iso, offer, amount) => {
    freezeDate(new Date(iso));
    const native = (await controller.catalog()).data;
    expect(native.salesEnabled).toBe(true);
    expect(native.launchAt).toBe(launchAt.toISOString());
    expect(native.launchEndsAt).toBe(launchEndsAt);
    expect(
      native.products.find((p) => p.productCode === 'DAY_PASS'),
    ).toMatchObject({
      productId: 'jlpt_day_pass',
      offerId: null,
      durationSeconds: 86400,
    });
    const year = native.products.find((p) => p.productCode === 'YEAR_PASS');
    if (offer === 'paused') expect(year).toBeUndefined();
    else
      expect(year).toMatchObject({
        offerId: offer,
        launchPrice: offer === 'launch-64',
        durationSeconds: 31536000,
      });
    const saved = await h.prisma.billingConfig.findUniqueOrThrow({
      where: { id: 'default' },
    });
    const web = catalogFor(saved, 'GLOBAL');
    expect(
      web.products.find((p) => p.productCode === 'YEAR_PASS')?.amount,
    ).toBe(amount);
    expect(saved.launchAt).toEqual(launchAt);
    expect(await h.prisma.paymentOrder.count()).toBe(0);
  },
);

test('minute-aligned shared deadline has no artificial pause', async () => {
  await h.prisma.billingConfig.update({
    where: { id: 'default' },
    data: { launchAt: new Date('2026-09-12T23:58:00Z') },
  });
  for (const [iso, offer] of [
    ['2027-03-12T23:57:59.999Z', 'launch-64'],
    ['2027-03-12T23:58:00.000Z', null],
  ]) {
    freezeDate(new Date(iso!));
    expect(
      (await controller.catalog()).data.products.find(
        (p) => p.productCode === 'YEAR_PASS',
      )?.offerId,
    ).toBe(offer);
    jest.useRealTimers();
  }
});
