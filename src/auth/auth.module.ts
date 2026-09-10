import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AdminGuard } from './admin.guard';
import { AuthService } from './auth.service';
import { GoogleStrategy } from './google.strategy';
import { SessionGuard } from './session.guard';

@Module({
  imports: [PassportModule.register({ session: false })],
  controllers: [AuthController],
  providers: [GoogleStrategy, AuthService, SessionGuard, AdminGuard],
  exports: [AuthService, SessionGuard, AdminGuard],
})
export class AuthModule {}
