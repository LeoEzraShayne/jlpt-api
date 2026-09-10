import { Module } from '@nestjs/common';
import { ContentModule } from '../content/content.module';
import { SceneService } from './scenes.service';

@Module({
  imports: [ContentModule],
  providers: [SceneService],
  exports: [SceneService],
})
export class SceneModule {}
