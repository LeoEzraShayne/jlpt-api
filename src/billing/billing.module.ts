import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  BillingController,
  EntitlementsController,
} from './billing.controller';
import { BillingService } from './billing.service';
import { EntitlementService } from './entitlement.service';
import { QuotaService } from './quota.service';
import { StripeGateway } from './stripe.gateway';
import { StripeWebhookService } from './stripe-webhook.service';
@Global()
@Module({
  imports: [AuthModule],
  controllers: [BillingController, EntitlementsController],
  providers: [
    BillingService,
    EntitlementService,
    QuotaService,
    StripeGateway,
    StripeWebhookService,
  ],
  exports: [QuotaService, EntitlementService],
})
export class BillingModule {}
