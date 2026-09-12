import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { BillingService } from '../../src/billing/billing.service';
import { StripeGateway } from '../../src/billing/stripe.gateway';
import { randomUUID } from 'node:crypto';
async function main() {
  const config = new ConfigService(process.env);
  if (
    config.get('BILLING_ENVIRONMENT') !== 'test' ||
    !new URL(config.getOrThrow('DATABASE_URL')).pathname.includes(
      'payments_20260913',
    )
  )
    throw new Error('Sandbox-only guard');
  const db = new PrismaService(config);
  try {
    const user = await db.user.upsert({
      where: { email: 'billing-sandbox@example.invalid' },
      create: {
        email: 'billing-sandbox@example.invalid',
        displayName: 'Billing sandbox',
      },
      update: {},
    });
    await db.billingConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        launchAt: new Date(),
        salesEnabled: true,
        enforcementEnabled: true,
        enforcementAt: new Date(),
      },
      update: { salesEnabled: true },
    });
    const billing = new BillingService(db, new StripeGateway(config), config);
    console.log(
      JSON.stringify(
        await billing.checkout(user.id, {
          productCode: 'DAY_PASS',
          market: 'GLOBAL',
          requestKey: randomUUID(),
          locale: 'en',
        }),
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Failed');
  process.exitCode = 1;
});
