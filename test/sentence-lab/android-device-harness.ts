/** Test-only process. Run with ts-node (decorator metadata), never deploy this entrypoint. */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/database/prisma.service';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { requestIdMiddleware } from '../../src/common/request-id.middleware';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4401' },
      'frontend-url': { type: 'string' },
      'api-public-url': { type: 'string' },
      'state-dir': { type: 'string' },
      'max-minutes': { type: 'string', default: '60' },
    },
  });
  const frontend = new URL(values['frontend-url'] ?? 'http://localhost:3059');
  const publicApi = new URL(values['api-public-url'] ?? frontend.origin);
  if (
    frontend.origin !== publicApi.origin ||
    frontend.pathname !== '/' ||
    frontend.username ||
    frontend.password ||
    frontend.search ||
    frontend.hash ||
    !['http:', 'https:'].includes(frontend.protocol)
  )
    throw new Error('SAME_ORIGIN_URL_REQUIRED');
  if (
    frontend.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(frontend.hostname)
  )
    throw new Error('HTTPS_OR_LOOPBACK_REQUIRED');
  const port = Number(values.port);
  const maxMinutes = Number(values['max-minutes']);
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !Number.isInteger(maxMinutes) ||
    maxMinutes < 1 ||
    maxMinutes > 120
  )
    throw new Error('INVALID_HARNESS_LIMITS');
  const repo = resolve(__dirname, '../..');
  const stateDir = values['state-dir']
    ? resolve(values['state-dir'])
    : await mkdtemp(join(tmpdir(), 'jlpt-f-device-state-'));
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  const leaseFile = join(stateDir, 'harness.lock');
  await writeFile(leaseFile, String(process.pid), { mode: 0o600, flag: 'wx' });
  const emptyCwd = await mkdtemp(join(tmpdir(), 'jlpt-f-empty-cwd-'));
  await chmod(emptyCwd, 0o700);
  let db: AcceptanceDatabase | undefined;
  let app: NestExpressApplication | undefined;
  let stopping = false;
  let expiryTimer: NodeJS.Timeout | undefined;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    await app?.close();
    await db?.stop();
    await Promise.all(
      ['state.json', 'cookie.txt', 'harness.lock'].map((name) =>
        rm(join(stateDir, name), { force: true }),
      ),
    );
    await rm(emptyCwd, { recursive: true, force: true });
    console.log(
      'F_ANDROID_HARNESS_STOPPED database dropped; secret files removed',
    );
  };
  try {
    // Preserve only local runtime necessities; inherited credentials/proxy/provider settings are discarded.
    const admin = process.env.TEST_DATABASE_ADMIN_URL;
    const allowed = new Set([
      'PATH',
      'HOME',
      'USER',
      'LOGNAME',
      'TMPDIR',
      'TZ',
      'LANG',
      'TERM',
    ]);
    for (const key of Object.keys(process.env))
      if (!allowed.has(key)) delete process.env[key];
    if (admin) process.env.TEST_DATABASE_ADMIN_URL = admin;
    process.chdir(repo);
    db = await acceptanceDatabase();
    process.chdir(emptyCwd); // ConfigModule.forRoot cannot discover the repository .env.
    Object.assign(process.env, {
      NODE_ENV: 'production',
      PORT: String(port),
      DATABASE_URL: db.connectionString,
      FRONTEND_URL: frontend.origin,
      SESSION_SECRET: randomBytes(48).toString('base64url'),
      BILLING_ENVIRONMENT: 'test',
      ANDROID_COMMERCE_ENABLED: 'true',
      ANDROID_COMMERCE_ENVIRONMENT: 'test',
      ANDROID_GOOGLE_ENABLED: 'false',
      ANDROID_ADMOB_ENABLED: 'false',
      GOOGLE_PLAY_PACKAGE_NAME: 'com.meritledger.app.debug',
      GOOGLE_CLIENT_ID: 'f-synthetic-no-oauth',
      GOOGLE_CLIENT_SECRET: 'f-synthetic-no-oauth',
      GOOGLE_CALLBACK_URL: `${frontend.origin}/api/v1/auth/google/callback`,
      AI_WORKER_ENABLED: 'false',
      GEMINI_FREE_FIRST: 'false',
    });
    const outboundDisabled = (): never => {
      throw new Error('F_HARNESS_OUTBOUND_HTTP_DISABLED');
    };
    http.request = outboundDisabled;
    http.get = outboundDisabled;
    https.request = outboundDisabled;
    https.get = outboundDisabled;
    globalThis.fetch = outboundDisabled;
    syncBuiltinESMExports();
    // Delayed CommonJS load is necessary: AppModule must evaluate only after environment isolation.
    const { AppModule } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../src/app.module') as typeof import('../../src/app.module');
    app = await NestFactory.create<NestExpressApplication>(AppModule, {
      rawBody: true,
      logger: false,
    });
    app.setGlobalPrefix('api/v1');
    app.useBodyParser('json', { limit: '2mb' });
    app.use(helmet());
    app.use(cookieParser());
    app.use(requestIdMiddleware);
    app.enableCors({ origin: frontend.origin, credentials: true });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new ApiExceptionFilter());
    const prisma = app.get(PrismaService);
    const identity = `f-device-${randomUUID()}`;
    const login = await app.get(AuthService).loginWithGoogle({
      providerId: identity,
      email: `${identity}@example.test`,
      displayName: 'F Android 合成测试帐号',
    });
    const source = await app.get(AuthService).authenticate(login.rawToken);
    const expiresAt = new Date(Date.now() + maxMinutes * 60_000);
    await prisma.authSession.update({
      where: { id: source.id },
      data: { expiresAt },
    });
    await prisma.billingConfig.create({
      data: {
        id: 'default',
        launchAt: new Date('2026-09-12T23:58:15.676Z'),
        enforcementEnabled: true,
        salesEnabled: false,
        rewardsEnabled: false,
        androidSalesEnabled: false,
        androidRewardsEnabled: false,
      },
    });
    const loginPath = `/api/v1/__f_test_login/${randomBytes(32).toString('base64url')}`;
    let loginUsed = false;
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        req.path === '/api/v1/auth/google' ||
        req.path === '/api/v1/auth/google/callback'
      ) {
        res.status(404).end();
        return;
      }
      if (!req.path.startsWith('/api/v1/__f_test_login/')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (
        req.method !== 'GET' ||
        req.path !== loginPath ||
        loginUsed ||
        Date.now() >= expiresAt.getTime()
      ) {
        res.status(404).end();
        return;
      }
      // A synchronous consume prevents parallel browser requests using the secret twice.
      loginUsed = true;
      res.cookie('jlpt_session', login.rawToken, {
        httpOnly: true,
        secure: frontend.protocol === 'https:',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });
      const target = new URL('/today', frontend.origin);
      target.searchParams.set('platform', 'android');
      target.searchParams.set('client', 'android-test');
      if (
        typeof req.query.bindingId === 'string' &&
        /^[0-9a-f-]{36}$/i.test(req.query.bindingId)
      ) {
        target.pathname = '/android/link';
        target.search = '';
        target.searchParams.set('bindingId', req.query.bindingId);
      }
      res.redirect(302, target.toString());
    });
    await app.listen(port, '127.0.0.1');
    await writeFile(
      join(stateDir, 'cookie.txt'),
      `jlpt_session=${login.rawToken}\n`,
      { mode: 0o600, flag: 'wx' },
    );
    await writeFile(
      join(stateDir, 'state.json'),
      JSON.stringify(
        {
          pid: process.pid,
          port,
          frontendUrl: frontend.origin,
          apiPublicUrl: publicApi.origin,
          databaseName: new URL(db.connectionString).pathname.slice(1),
          userId: login.user.id,
          sourceSessionId: source.id,
          loginPath,
          loginUrl: `${publicApi.origin}${loginPath}`,
          expiresAt: expiresAt.toISOString(),
          cookieFile: join(stateDir, 'cookie.txt'),
          flags: { commerce: true, google: false, admob: false },
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      `F_ANDROID_HARNESS_READY port=${port} state=${join(stateDir, 'state.json')}`,
    );
    for (const signal of ['SIGINT', 'SIGTERM'] as const)
      process.once(signal, () => {
        void stop().then(() => process.exit(0));
      });
    expiryTimer = setTimeout(() => {
      void stop().then(() => process.exit(0));
    }, maxMinutes * 60_000);
  } catch (error) {
    await stop();
    throw error;
  }
}
void main().catch((error: unknown) => {
  // Do not serialize request objects, URLs, credentials or response bodies.
  console.error(
    'F_ANDROID_HARNESS_FAILED',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
