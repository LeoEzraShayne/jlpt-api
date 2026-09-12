import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { activateWebBilling } from './activation';

async function main() {
  const config = new ConfigService(process.env);
  const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.BILLING_ENVIRONMENT !== 'live' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.pathname !== '/jlpt'
  )
    throw Error('Explicit production jlpt configuration required');
  for (const field of [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_DAY_USD',
    'STRIPE_PRICE_YEAR_USD_LAUNCH',
    'STRIPE_PRICE_YEAR_USD_STANDARD',
    'DEEPSEEK_API_KEY',
  ])
    if (!process.env[field]) throw Error(`Missing ${field}`);
  if (!/^(rk|sk)_live_/.test(process.env.STRIPE_SECRET_KEY!))
    throw Error('Live Stripe key required');
  const db = new PrismaService(config);
  try {
    if (!process.argv.includes('--commit')) {
      console.log(
        JSON.stringify({
          dryRun: true,
          current: await db.billingConfig.findUnique({
            where: { id: 'default' },
          }),
          nextAction:
            'Complete provider acceptance and live payment readiness before --commit',
        }),
      );
      return;
    }
    console.log(
      JSON.stringify(
        await activateWebBilling(db, new EntitlementService(config)),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch(() => {
  console.error('Web activation stopped; no secrets logged');
  process.exitCode = 1;
});
