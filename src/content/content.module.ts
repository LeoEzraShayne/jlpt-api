import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContentController } from './content.controller';
import { ContentImportService } from './content-import.service';
import { ContentSelectionService } from './content-selection.service';
import { ExpressionsService } from './expressions.service';
import { VocabularyService } from './vocabulary.service';

@Module({
  imports: [AuthModule],
  controllers: [ContentController],
  providers: [
    VocabularyService,
    ExpressionsService,
    ContentImportService,
    ContentSelectionService,
  ],
  exports: [VocabularyService, ExpressionsService, ContentSelectionService],
})
export class ContentModule {}
