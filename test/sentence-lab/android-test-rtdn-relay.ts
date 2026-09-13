/** Loopback-only test ingress; never deploy or attach to the legacy production subscription. */
import 'reflect-metadata';
import { createServer } from 'node:http';
import { writeFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { GoogleGateway } from '../../src/android-commerce/google.gateway';
import { platformConfig } from './android-platform-config';
import { AndroidTestRtdnFilter } from './android-test-rtdn-filter';

async function main() {
  const { values } = parseArgs({
    options: {
      'platform-config': { type: 'string' },
      'state-dir': { type: 'string' },
      port: { type: 'string', default: '4403' },
    },
  });
  if (!values['platform-config'] || !values['state-dir'])
    throw new Error('RELAY_PRIVATE_CONFIG_REQUIRED');
  const configPath = resolve(values['platform-config']);
  const stateDir = resolve(values['state-dir']);
  const stat = await lstat(stateDir);
  if (
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('PRIVATE_STATE_DIRECTORY_REQUIRED');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4401)
    throw new Error('INVALID_RELAY_PORT');
  let settings = await platformConfig(configPath);
  const config = new ConfigService({
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    GOOGLE_PLAY_PACKAGE_NAME: 'com.meritledger.app',
  });
  const apply = (next: typeof settings) => {
    if (
      !next.googleCredentialsFile ||
      !next.rtdnAudience ||
      !next.rtdnSubscription ||
      !next.rtdnServiceAccountEmail
    )
      throw new Error('RTDN_RELAY_CONFIG_INCOMPLETE');
    if (next.googleCredentialsFile !== settings.googleCredentialsFile)
      throw new Error('RELAY_CREDENTIAL_IDENTITY_CHANGE_FORBIDDEN');
    config.set('GOOGLE_PLAY_CREDENTIALS_FILE', next.googleCredentialsFile);
    config.set('GOOGLE_RTDN_AUDIENCE', next.rtdnAudience);
    config.set('GOOGLE_RTDN_SUBSCRIPTION', next.rtdnSubscription);
    config.set(
      'GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL',
      next.rtdnServiceAccountEmail,
    );
    settings = next;
  };
  apply(settings);
  const filter = new AndroidTestRtdnFilter(
    config,
    new GoogleGateway(new AndroidPolicy(config)),
  );
  const stats = {
    forwarded: 0,
    filtered: 0,
    failed: 0,
    lastStatus: 0,
    lastAt: '',
  };
  const save = async () => {
    await writeFile(
      join(stateDir, 'rtdn-relay-stats.json'),
      JSON.stringify(stats),
      { mode: 0o600 },
    );
  };
  const path = '/api/v1/android/commerce/google/rtdn';
  const server = createServer((req, res) => {
    void (async () => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"status":"ok","scope":"test-relay"}');
        return;
      }
      if (req.method !== 'POST' || req.url !== path) {
        res.writeHead(404);
        res.end();
        return;
      }
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as string);
          size += bytes.length;
          if (size > 65536) throw new HttpException('Body too large', 413);
          chunks.push(bytes);
        }
        const body = Buffer.concat(chunks);
        const decision = await filter.decide(
          req.headers.authorization,
          JSON.parse(body.toString('utf8')),
        );
        if (decision === 'filtered') {
          stats.filtered++;
          stats.lastStatus = 200;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"received":true,"filtered":true}');
        } else {
          const upstream = await fetch(`http://127.0.0.1:4401${path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: req.headers.authorization!,
            },
            body,
            redirect: 'error',
            signal: AbortSignal.timeout(15000),
          });
          stats.lastStatus = upstream.status;
          if (upstream.ok) stats.forwarded++;
          else stats.failed++;
          res.writeHead(upstream.status, {
            'Content-Type': 'application/json',
          });
          res.end(Buffer.from(await upstream.arrayBuffer()));
        }
      } catch (error) {
        stats.failed++;
        stats.lastStatus =
          error instanceof HttpException
            ? error.getStatus()
            : error instanceof SyntaxError
              ? 400
              : 503;
        res.writeHead(stats.lastStatus, { 'Content-Type': 'application/json' });
        res.end('{"error":"TEST_RELAY_REJECTED_OR_RETRY_REQUIRED"}');
      } finally {
        stats.lastAt = new Date().toISOString();
        await save();
      }
    })().catch(() => {
      if (!res.writableEnded) {
        res.writeHead(503);
        res.end();
      }
    });
  });
  process.on('SIGHUP', () => {
    void platformConfig(configPath)
      .then(apply)
      .then(() => console.log('TEST_RTDN_RELAY_CONFIG_RELOADED'))
      .catch(() => console.error('TEST_RTDN_RELAY_CONFIG_RELOAD_FAILED'));
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => server.close(() => process.exit(0)));
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', done);
  });
  await writeFile(
    join(stateDir, 'rtdn-relay.json'),
    JSON.stringify({
      pid: process.pid,
      port,
      scope: 'test-only',
      upstreamPort: 4401,
    }),
    { mode: 0o600 },
  );
  await save();
  console.log(`TEST_RTDN_RELAY_READY port=${port}`);
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'TEST_RTDN_RELAY_FAILED');
  process.exitCode = 1;
});
