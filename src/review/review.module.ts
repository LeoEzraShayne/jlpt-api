import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewController } from './review.controller';
import { ContentLocalizationModule } from '../content-localization/content-localization.module';

@Module({
  imports: [AuthModule, ContentLocalizationModule],
  controllers: [ReviewController],
})
export class ReviewModule {}
