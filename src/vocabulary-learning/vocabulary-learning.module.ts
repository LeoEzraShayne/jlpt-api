import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { VocabularyAiService } from './vocabulary-ai.service';
import { VocabularyLearningController } from './vocabulary-learning.controller';
import { VocabularyLearningService } from './vocabulary-learning.service';
import { VocabularyPracticeService } from './vocabulary-practice.service';
import { VocabularyPracticeWorker } from './vocabulary-practice.worker';

@Module({
  imports: [AuthModule, DatabaseModule, ConfigModule],
  controllers: [VocabularyLearningController],
  providers: [
    VocabularyLearningService,
    VocabularyPracticeService,
    VocabularyAiService,
    VocabularyPracticeWorker,
  ],
  exports: [VocabularyLearningService, VocabularyPracticeService],
})
export class VocabularyLearningModule {}
