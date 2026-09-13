import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AndroidPolicy } from './android.policy';
import { AndroidAuthController } from './android-auth.controller';
import { AndroidAuthService } from './android-auth.service';
import { AndroidSessionGuard } from './android-session.guard';
@Module({
  imports: [AuthModule],
  controllers: [AndroidAuthController],
  providers: [AndroidPolicy, AndroidAuthService, AndroidSessionGuard],
  exports: [AndroidAuthService, AndroidSessionGuard],
})
export class AndroidCommerceModule {}
