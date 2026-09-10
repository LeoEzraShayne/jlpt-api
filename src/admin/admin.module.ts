import { LearningV2Controller } from './learning-v2.controller';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { ReviewAlgorithmController } from './review-algorithm.controller';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminController,
    ReviewAlgorithmController,
    LearningV2Controller,
  ],
})
export class AdminModule {}
