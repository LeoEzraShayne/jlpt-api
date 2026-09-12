import { ContentLocalizationModule } from '../content-localization/content-localization.module';
import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { SceneService } from './scenes.service';

@Module({
  imports: [ContentModule, ContentLocalizationModule],
  providers: [SceneService],
  exports: [SceneService],
})
export class SceneModule {}
