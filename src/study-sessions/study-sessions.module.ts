import { ContentLocalizationModule } from '../content-localization/content-localization.module';
import { SceneModule } from '../scenes/scenes.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudySessionsController } from './study-sessions.controller';
import { StudySessionsService } from './study-sessions.service';

@Module({
  imports: [AuthModule, SceneModule, ContentLocalizationModule],
  controllers: [StudySessionsController],
  providers: [StudySessionsService],
})
export class StudySessionsModule {}
