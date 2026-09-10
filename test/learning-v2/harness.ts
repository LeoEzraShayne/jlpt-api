import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  ValidationPipe,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { DatabaseModule } from '../../src/database/database.module';
import { PrismaService } from '../../src/database/prisma.service';
import { AuthModule } from '../../src/auth/auth.module';
import { AdminModule } from '../../src/admin/admin.module';
import { AuthService } from '../../src/auth/auth.service';
import { StudyPlansModule } from '../../src/study-plans/study-plans.module';
import { DashboardModule } from '../../src/dashboard/dashboard.module';
import { StudySessionsModule } from '../../src/study-sessions/study-sessions.module';
import { ContentModule } from '../../src/content/content.module';
import { GrammarModule } from '../../src/grammar/grammar.module';
import { UsersModule } from '../../src/users/users.module';
import { ReviewModule } from '../../src/review/review.module';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';

@Catch()
class DiagnosticFilter extends ApiExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    if (!(error instanceof HttpException)) console.error(error);
    super.catch(error, host);
  }
}
export type Harness = Awaited<ReturnType<typeof startHarness>>;
export async function startHarness(legacySeed?: (db: Client) => Promise<void>) {
  const adminUrl = new URL(
    process.env.TEST_DATABASE_ADMIN_URL ??
      `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`,
  );
  if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname))
    throw new Error('Local test PostgreSQL only');
  const database = `jlpt_v2_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  let app: NestExpressApplication | undefined;
  const db = new Client({ connectionString: url.toString() });
  async function stop() {
    await app?.close();
    await db.end();
    await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
  try {
    await db.connect();
    let legacySeeded = false;
    for (const name of (await readdir('prisma/migrations'))
      .filter((n) => /^\d/.test(n))
      .sort()) {
      if (
        !legacySeeded &&
        legacySeed &&
        name >= '202609100002_learning_v2_enums'
      ) {
        await legacySeed(db);
        legacySeeded = true;
      }
      await db.query(
        await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8'),
      );
    }
    const config = {
      NODE_ENV: 'test',
      DATABASE_URL: url.toString(),
      SESSION_SECRET: 'f-integration-fixture-secret-32-characters',
      FRONTEND_URL: 'http://localhost:3100',
      GOOGLE_CLIENT_ID: 'test-only',
      GOOGLE_CLIENT_SECRET: 'test-only',
      GOOGLE_CALLBACK_URL: 'http://localhost:4000/callback',
      AI_WORKER_ENABLED: false,
      GEMINI_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      REVIEW_ALGORITHM_MODE: 'adaptive',
      REVIEW_ALGORITHM_ROLLOUT_PERCENT: 100,
    };
    // No AppModule import: never parse local .env or instantiate an AI worker.
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          skipProcessEnv: true,
          load: [() => config],
        }),
        DatabaseModule,
        AuthModule,
        AdminModule,
        StudyPlansModule,
        DashboardModule,
        StudySessionsModule,
        ContentModule,
        GrammarModule,
        UsersModule,
        ReviewModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api/v1');
    app.useBodyParser('json', { limit: '2mb' });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new DiagnosticFilter());
    await app.init();
    const prisma = app.get(PrismaService);
    const http = (cookie?: string) => {
      const agent = request(app!.getHttpServer());
      return {
        get: (path: string) =>
          agent.get(`/api/v1${path}`).set('Cookie', cookie ?? ''),
        post: (path: string, body = {}) =>
          agent
            .post(`/api/v1${path}`)
            .set('Cookie', cookie ?? '')
            .send(body),
        put: (path: string, body = {}) =>
          agent
            .put(`/api/v1${path}`)
            .set('Cookie', cookie ?? '')
            .send(body),
        patch: (path: string, body = {}) =>
          agent
            .patch(`/api/v1${path}`)
            .set('Cookie', cookie ?? '')
            .send(body),
        delete: (path: string) =>
          agent.delete(`/api/v1${path}`).set('Cookie', cookie ?? ''),
      };
    };
    const login = async (name: string) => {
      const result = await app!.get(AuthService).loginWithGoogle({
        providerId: name,
        email: `${name}@example.test`,
        displayName: name,
      });
      await prisma.user.update({
        where: { id: result.user.id },
        data: { learningV2Enabled: true, timezone: 'Asia/Tokyo' },
      });
      return {
        user: result.user,
        http: http(`jlpt_session=${result.rawToken}`),
      };
    };
    for (const level of ['N1', 'N2', 'N3', 'N4'] as const) {
      await prisma.grammarPoint.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          id: `f-${level}-${i}`,
          level,
          title: i === 0 ? 'ながら' : `テスト${i}`,
          chineseExplanation: '测试内容',
          sourceDataset: 'f-synthetic',
          sourceHash: `f-${level}-${i}`,
          sourceOrdinal: i,
          sortOrder: i,
          status: 'PUBLISHED',
        })),
      });
    }
    return { app, prisma, db, http, login, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
