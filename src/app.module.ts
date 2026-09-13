import { BillingModule } from './billing/billing.module';
import { AndroidCommerceModule } from './android-commerce/android-commerce.module';
import { VocabularyLearningModule } from './vocabulary-learning/vocabulary-learning.module';
import { ContentModule } from './content/content.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { OriginGuard } from './common/origin.guard';
import { validateEnv } from './config/env';
import { DashboardModule } from './dashboard/dashboard.module';
import { DatabaseModule } from './database/database.module';
import { GrammarModule } from './grammar/grammar.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './imports/imports.module';
import { UsersModule } from './users/users.module';
import { ReviewModule } from './review/review.module';
import { StudyPlansModule } from './study-plans/study-plans.module';
import { StudySessionsModule } from './study-sessions/study-sessions.module';
import { SentenceReviewsModule } from './sentence-reviews/sentence-reviews.module';
import { HistoryModule } from './history/history.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    BillingModule,
    AndroidCommerceModule,
    HealthModule,
    AuthModule,
    AdminModule,
    ImportsModule,
    ContentModule,
    VocabularyLearningModule,
    UsersModule,
    GrammarModule,
    DashboardModule,
    StudyPlansModule,
    ReviewModule,
    StudySessionsModule,
    SentenceReviewsModule,
    HistoryModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
  ],
})
export class AppModule {}
