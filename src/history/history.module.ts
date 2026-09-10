import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HistoryController } from './history.controller';

@Module({ imports: [AuthModule], controllers: [HistoryController] })
export class HistoryModule {}
