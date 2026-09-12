import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentLocalizationService } from './content-localization.service';
import { ContentLocalizationController } from './content-localization.controller';
@Module({
  imports: [AuthModule],
  providers: [ContentLocalizationService],
  controllers: [ContentLocalizationController],
  exports: [ContentLocalizationService],
})
export class ContentLocalizationModule {}
