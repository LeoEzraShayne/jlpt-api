import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewController } from './review.controller';

@Module({ imports: [AuthModule], controllers: [ReviewController] })
export class ReviewModule {}
