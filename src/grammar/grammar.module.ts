import { ContentLocalizationModule } from '../content-localization/content-localization.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GrammarController } from './grammar.controller';
import { GrammarService } from './grammar.service';

@Module({
  imports: [AuthModule, ContentLocalizationModule],
  controllers: [GrammarController],
  providers: [GrammarService],
})
export class GrammarModule {}
