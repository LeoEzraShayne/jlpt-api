import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AndroidPolicy } from './android.policy';
import { AndroidAuthController } from './android-auth.controller';
import { AndroidAuthService } from './android-auth.service';
import { AndroidSessionGuard } from './android-session.guard';
import { BillingModule } from '../billing/billing.module';
import { GoogleGateway } from './google.gateway';
import { GooglePurchaseService } from './google-purchase.service';
import { GoogleNotificationsService } from './google-notifications.service';
import { AdmobVerifier } from './admob-verifier';
import { AdmobRewardService } from './admob-reward.service';
import {
  AndroidCallbacksController,
  AndroidCommerceController,
} from './android-commerce.controller';
@Module({
  imports: [AuthModule, BillingModule],
  controllers: [
    AndroidAuthController,
    AndroidCommerceController,
    AndroidCallbacksController,
  ],
  providers: [
    AndroidPolicy,
    AndroidAuthService,
    AndroidSessionGuard,
    GoogleGateway,
    GooglePurchaseService,
    GoogleNotificationsService,
    AdmobVerifier,
    AdmobRewardService,
  ],
  exports: [AndroidAuthService, AndroidSessionGuard],
})
export class AndroidCommerceModule {}
