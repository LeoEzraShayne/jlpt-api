/** Test-only process. Run with ts-node (decorator metadata), never deploy this entrypoint. */
import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  readdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from '../../src/auth/auth.service';
import { PrismaService } from '../../src/database/prisma.service';
import { ApiExceptionFilter } from '../../src/common/api-exception.filter';
import { requestIdMiddleware } from '../../src/common/request-id.middleware';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
import { platformConfig, providerFetch } from './android-platform-config';
import { GoogleNotificationsService } from '../../src/android-commerce/google-notifications.service';
import { AdmobRewardService } from '../../src/android-commerce/admob-reward.service';
import { AdmobVerifier } from '../../src/android-commerce/admob-verifier';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { EntitlementService } from '../../src/billing/entitlement.service';

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4401' },
      'frontend-url': { type: 'string' },
      'api-public-url': { type: 'string' },
      'state-dir': { type: 'string' },
      'platform-config': { type: 'string' },
      'discard-on-exit': { type: 'boolean', default: false },
      'max-minutes': { type: 'string', default: '60' },
    },
  });
  if (!values['platform-config']) throw new Error('PLATFORM_CONFIG_REQUIRED');
  const configPath = resolve(values['platform-config']);
  let platform = await platformConfig(configPath);
  const originalFetch = globalThis.fetch;
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
    : await mkdtemp(join(tmpdir(), 'jlpt-platform-state-'));
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  await chmod(stateDir, 0o700);
  if ((await readdir(stateDir)).length)
    throw new Error('EMPTY_STATE_DIRECTORY_REQUIRED_PRESERVE_EXISTING_STATE');
  const leaseFile = join(stateDir, 'harness.lock');
  await writeFile(leaseFile, String(process.pid), { mode: 0o600, flag: 'wx' });
  const emptyCwd = await mkdtemp(join(tmpdir(), 'jlpt-f-empty-cwd-'));
  await chmod(emptyCwd, 0o700);
  let db: AcceptanceDatabase | undefined;
  let app: NestExpressApplication | undefined;
  let stopping = false;
  let ready = false;
  let expiryTimer: NodeJS.Timeout | undefined;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    await app?.close();
    const discard = !ready || values['discard-on-exit'];
    if (discard) await db?.stop();
    else {
      await db?.prisma.$disconnect();
      await db?.sql.end();
    }
    if (discard)
      await Promise.all(
        [
          'state.json',
          'cookie.txt',
          'reward-cookie.txt',
          'ssv-ticket.json',
          'harness.lock',
          'token-encryption-key.txt',
        ].map((name) => rm(join(stateDir, name), { force: true })),
      );
    await rm(leaseFile, { force: true });
    await rm(emptyCwd, { recursive: true, force: true });
    console.log(
      discard
        ? 'ANDROID_PLATFORM_HARNESS_STOPPED database dropped; secret files removed'
        : 'ANDROID_PLATFORM_HARNESS_STOPPED private test database and state retained',
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
      ANDROID_GOOGLE_ENABLED: String(!!platform.googleCredentialsFile),
      ANDROID_ADMOB_ENABLED: String(!platform.admobSsvVerifierOnly),
      GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
      ADMOB_REWARDED_AD_UNIT_ID: platform.adUnit,
      ADMOB_REWARD_ITEM: platform.admobRewardItem,
      GOOGLE_PLAY_PACKAGE_NAME: 'com.meritledger.app',
      GOOGLE_CLIENT_ID: 'f-synthetic-no-oauth',
      GOOGLE_CLIENT_SECRET: 'f-synthetic-no-oauth',
      GOOGLE_CALLBACK_URL: `${frontend.origin}/api/v1/auth/google/callback`,
      AI_WORKER_ENABLED: 'false',
      GEMINI_FREE_FIRST: 'false',
    });
    await writeFile(
      join(stateDir, 'token-encryption-key.txt'),
      process.env.GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY!,
      { mode: 0o600, flag: 'wx' },
    );
    for (const [key, value] of Object.entries({
      GOOGLE_PLAY_CREDENTIALS_FILE: platform.googleCredentialsFile,
      GOOGLE_RTDN_AUDIENCE: platform.rtdnAudience,
      GOOGLE_RTDN_SUBSCRIPTION: platform.rtdnSubscription,
      GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: platform.rtdnServiceAccountEmail,
    }))
      if (value) process.env[key] = value;
    const outboundDisabled = (): never => {
      throw new Error('F_HARNESS_OUTBOUND_HTTP_DISABLED');
    };
    http.request = outboundDisabled;
    http.get = outboundDisabled;
    https.request = outboundDisabled;
    https.get = outboundDisabled;
    globalThis.fetch = providerFetch(originalFetch);
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
    // Global voided history can contain unrelated live orders; do not import it into this test DB.
    // Explicit real test token reconciliation remains enabled; this is not a voided-sync acceptance.
    app.get(GoogleNotificationsService).syncVoided = async () => {};
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
        androidSalesEnabled: !!platform.googleCredentialsFile,
        androidRewardsEnabled: true,
      },
    });
    const rewardLogin = await app.get(AuthService).loginWithGoogle({
      providerId: `reward-${identity}`,
      email: `reward-${identity}@example.test`,
      displayName: 'Android 广告合成测试帐号',
    });
    const rewardSource = await app
      .get(AuthService)
      .authenticate(rewardLogin.rawToken);
    await prisma.authSession.update({
      where: { id: rewardSource.id },
      data: { expiresAt },
    });
    const rewardLoginPath = `/api/v1/__f_test_login/${randomBytes(32).toString('base64url')}`;
    if (platform.admobSsvVerifierOnly) {
      // Private operator-only issuance for Google's verification tool; native SDK entry stays off.
      const ticketPolicy = new AndroidPolicy(
        new ConfigService({
          DATABASE_URL: db.connectionString,
          BILLING_ENVIRONMENT: 'test',
          ANDROID_COMMERCE_ENVIRONMENT: 'test',
          ANDROID_COMMERCE_ENABLED: true,
          ANDROID_ADMOB_ENABLED: true,
          ADMOB_REWARDED_AD_UNIT_ID: platform.adUnit,
          ADMOB_REWARD_ITEM: platform.admobRewardItem,
        }),
      );
      const issuer = new AdmobRewardService(
        prisma,
        ticketPolicy,
        app.get(EntitlementService),
        app.get(AdmobVerifier),
      );
      let issuing = false;
      const mint = async () => {
        if (issuing || stopping || !platform.admobSsvVerifierOnly) return;
        issuing = true;
        try {
          ticketPolicy.config.set('ADMOB_REWARDED_AD_UNIT_ID', platform.adUnit);
          ticketPolicy.config.set(
            'ADMOB_REWARD_ITEM',
            platform.admobRewardItem,
          );
          const ticket = await issuer.create(rewardLogin.user.id, randomUUID());
          // Observed Verify URL placeholder; this isolated ticket is not an SDK impression.
          await prisma.rewardTicket.update({
            where: { id: ticket.ticketId },
            data: { ssvAdUnitId: '1234567890' },
          });
          await writeFile(
            join(stateDir, 'ssv-ticket.json'),
            JSON.stringify({
              ...ticket,
              purpose:
                'Google AdMob Verify URL tool only; no viewed-ad evidence',
              expectedToolAdUnit: '1234567890',
              callbackUrl: `${publicApi.origin}/api/v1/android/commerce/admob/ssv`,
            }),
            { mode: 0o600 },
          );
        } finally {
          issuing = false;
        }
      };
      await mint();
      process.on('SIGUSR2', () => {
        void mint().catch(() => console.error('PLATFORM_TICKET_MINT_FAILED'));
      });
    }
    const usedLogins = new Set<string>();
    const loginPath = `/api/v1/__f_test_login/${randomBytes(32).toString('base64url')}`;
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
        ![loginPath, rewardLoginPath].includes(req.path) ||
        usedLogins.has(req.path) ||
        Date.now() >= expiresAt.getTime()
      ) {
        res.status(404).end();
        return;
      }
      // A synchronous consume prevents parallel browser requests using the secret twice.
      usedLogins.add(req.path);
      res.cookie(
        'jlpt_session',
        req.path === rewardLoginPath ? rewardLogin.rawToken : login.rawToken,
        {
          httpOnly: true,
          secure: frontend.protocol === 'https:',
          sameSite: 'lax',
          path: '/',
          expires: expiresAt,
        },
      );
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
      join(stateDir, 'reward-cookie.txt'),
      `jlpt_session=${rewardLogin.rawToken}\n`,
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
          rewardUserId: rewardLogin.user.id,
          rewardLoginUrl: `${publicApi.origin}${rewardLoginPath}`,
          rewardCookieFile: join(stateDir, 'reward-cookie.txt'),
          flags: {
            commerce: true,
            google: !!platform.googleCredentialsFile,
            admob: !platform.admobSsvVerifierOnly,
          },
          packageName: 'com.meritledger.app',
          environment: 'test',
          globalVoidedScan: 'disabled-no-unrelated-live-orders',
          admobMode: platform.admobSsvVerifierOnly
            ? 'ssv-verifier-only-native-ads-disabled'
            : platform.admobTestDeviceConfirmed
              ? 'owned-unit-test-device'
              : 'demo-unit-sdk-only',
        },
        null,
        2,
      ),
      { mode: 0o600, flag: 'wx' },
    );
    let reloading = false;
    process.on('SIGHUP', () => {
      if (reloading || stopping) return;
      reloading = true;
      void (async () => {
        const next = await platformConfig(configPath);
        if (next.googleCredentialsFile !== platform.googleCredentialsFile)
          throw new Error('PLATFORM_CREDENTIAL_IDENTITY_CHANGE_FORBIDDEN');
        const config = app!.get(ConfigService);
        await prisma.billingConfig.update({
          where: { id: 'default' },
          data: {
            androidSalesEnabled: !!next.googleCredentialsFile,
            androidRewardsEnabled: true,
          },
        });
        for (const [key, value] of Object.entries({
          GOOGLE_RTDN_AUDIENCE: next.rtdnAudience,
          GOOGLE_RTDN_SUBSCRIPTION: next.rtdnSubscription,
          GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL: next.rtdnServiceAccountEmail,
          ADMOB_REWARDED_AD_UNIT_ID: next.adUnit,
          ADMOB_REWARD_ITEM: next.admobRewardItem,
          ANDROID_ADMOB_ENABLED: !next.admobSsvVerifierOnly,
        }))
          config.set(key, value);
        platform = next;
        const path = join(stateDir, 'state.json');
        const state = JSON.parse(await readFile(path, 'utf8')) as Record<
          string,
          unknown
        >;
        state.flags = {
          commerce: true,
          google: !!next.googleCredentialsFile,
          admob: !next.admobSsvVerifierOnly,
        };
        state.admobMode = next.admobSsvVerifierOnly
          ? 'ssv-verifier-only-native-ads-disabled'
          : next.admobTestDeviceConfirmed
            ? 'owned-unit-test-device'
            : 'demo-unit-sdk-only';
        state.platformReloadedAt = new Date().toISOString();
        state.rtdnConfigured = !!(
          next.rtdnAudience &&
          next.rtdnSubscription &&
          next.rtdnServiceAccountEmail
        );
        await writeFile(path, JSON.stringify(state), { mode: 0o600 });
        console.log(
          'ANDROID_PLATFORM_CONFIG_RELOADED database and sessions retained',
        );
      })()
        .catch(() => console.error('ANDROID_PLATFORM_CONFIG_RELOAD_FAILED'))
        .finally(() => {
          reloading = false;
        });
    });
    ready = true;
    console.log(
      `ANDROID_PLATFORM_HARNESS_READY port=${port} state=${join(stateDir, 'state.json')}`,
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
    'ANDROID_PLATFORM_HARNESS_FAILED',
    error instanceof Error ? error.name : 'UnknownError',
  );
  process.exitCode = 1;
});
