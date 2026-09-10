import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiReviewService } from '../ai/ai-review.service';
import { AiWorkerService } from '../ai/ai-worker.service';
import { DeepSeekReviewProvider } from '../ai/deepseek.provider';
import { GeminiReviewProvider } from '../ai/gemini.provider';
import { SentenceReviewsController } from './sentence-reviews.controller';
import { SentenceReviewsService } from './sentence-reviews.service';

@Module({
  imports: [AuthModule],
  controllers: [SentenceReviewsController],
  providers: [
    SentenceReviewsService,
    GeminiReviewProvider,
    DeepSeekReviewProvider,
    AiReviewService,
    AiWorkerService,
  ],
})
export class SentenceReviewsModule {}
