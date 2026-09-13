import { HttpException } from '@nestjs/common';
import type { BillingConfig } from '@prisma/client';
import type { BillingMarket, Catalog } from '../contracts/sentence-lab';

export const DAY_SECONDS = 86_400;
export const GIFT_EMAIL = 'leo.ezra.shayne@gmail.com';
/** Six UTC calendar months; clamp missing month-end days, preserving time. */
export function launchOfferEndsAt(launchAt: Date): Date {
  const endsAt = new Date(launchAt);
  endsAt.setUTCMonth(endsAt.getUTCMonth() + 6, 1);
  const monthEnd = new Date(endsAt);
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  endsAt.setUTCDate(Math.min(launchAt.getUTCDate(), monthEnd.getUTCDate()));
  return endsAt;
}
export function billingError(code: string, status = 409): never {
  throw new HttpException({ code, message: code }, status);
}
export function catalogFor(
  config: BillingConfig | null,
  market: BillingMarket,
  now = new Date(),
): Catalog {
  const launchEndsAt = config?.launchAt
    ? launchOfferEndsAt(config.launchAt)
    : null;
  const launch =
    !!config?.launchAt && now >= config.launchAt && now < launchEndsAt!;
  return {
    market,
    salesEnabled: config?.salesEnabled ?? false,
    launchAt: config?.launchAt?.toISOString() ?? null,
    launchEndsAt: launchEndsAt?.toISOString() ?? null,
    products: [
      {
        productCode: 'DAY_PASS',
        currency: 'USD',
        amount: 99,
        durationSeconds: DAY_SECONDS,
        launchPrice: false,
      },
      {
        productCode: 'YEAR_PASS',
        currency: 'USD',
        amount: launch ? 6400 : 9900,
        durationSeconds: 365 * DAY_SECONDS,
        launchPrice: launch,
      },
    ],
  };
}
