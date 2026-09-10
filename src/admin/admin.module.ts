import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { ReviewAlgorithmController } from './review-algorithm.controller';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, ReviewAlgorithmController],
})
export class AdminModule {}
