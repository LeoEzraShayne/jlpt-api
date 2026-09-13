/** Explicit manual tool; never imported by AppModule. No listener, scheduler or .env. */
import 'reflect-metadata';
import { lstat, readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { tmpdir, userInfo } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { PrismaService } from '../../src/database/prisma.service';
import { EntitlementService } from '../../src/billing/entitlement.service';
import { AndroidPolicy } from '../../src/android-commerce/android.policy';
import { GoogleGateway } from '../../src/android-commerce/google.gateway';
import { GooglePurchaseService } from '../../src/android-commerce/google-purchase.service';
import {
  guardYearPurchase,
  tokenHash,
  yearExport,
  yearManifest,
  yearPin,
} from './year-license-guard';

const stateSchema = z.object({
  schemaVersion: z.literal(1),
  databaseUrl: z.string(),
  userId: z.string(),
  encryptionKey: z.string().regex(/^[a-f0-9]{64}$/),
  credentialsFile: z.string(),
  manifest: yearManifest,
});
const must = (ok: boolean, code: string) => {
  if (!ok) throw Error(code);
};
async function privateJson(path: string) {
  const stat = await lstat(path);
  must(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid?.(),
    'PRIVATE_FILE_REQUIRED',
  );
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
const save = (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
function databaseUrl(value: string, admin = false) {
  const url = new URL(value);
  must(
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
    'LOCAL_DATABASE_REQUIRED',
  );
  must(
    admin
      ? url.pathname === '/postgres'
      : /^\/jlpt_year_license_test_\d+_[a-f0-9]+$/.test(url.pathname),
    'ISOLATED_DATABASE_REQUIRED',
  );
  return url;
}
async function prepare() {
  const base = await mkdtemp(join(tmpdir(), 'jlpt-year-license-'));
  const adminUrl = databaseUrl(
    process.env.TEST_DATABASE_ADMIN_URL ??
      `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`,
    true,
  );
  const name = `jlpt_year_license_test_${Date.now()}_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  adminUrl.pathname = `/${name}`;
  const sql = new Client({ connectionString: adminUrl.toString() });
  await sql.connect();
  try {
    for (const migration of (await readdir('prisma/migrations'))
      .filter((n) => /^\d/.test(n))
      .sort())
      await sql.query(
        await readFile(
          join('prisma/migrations', migration, 'migration.sql'),
          'utf8',
        ),
      );
  } finally {
    await sql.end();
  }
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: adminUrl.toString() }),
  });
  try {
    const manifest = yearManifest.parse({
      schemaVersion: 1,
      runId: randomUUID(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 2 * 3600000).toISOString(),
      packageName: 'com.meritledger.app',
      productId: 'jlpt_year_pass',
      purchaseOptionId: 'buy',
      offerId: 'launch-64',
      currency: 'JPY',
      priceAmountMicros: 9824000000,
      obfuscatedAccountId: randomUUID(),
    });
    const user = await db.user.create({
      data: {
        email: `${manifest.runId}@example.test`,
        displayName: 'Isolated year license fixture',
        googlePlayAccountId: manifest.obfuscatedAccountId,
      },
    });
    await db.billingConfig.create({ data: { id: 'default' } });
    const state = stateSchema.parse({
      schemaVersion: 1,
      databaseUrl: adminUrl.toString(),
      userId: user.id,
      encryptionKey: randomBytes(32).toString('hex'),
      credentialsFile:
        '/Users/shen/Downloads/jlpt/.local/google-play-backend-service-account.json',
      manifest,
    });
    await save(join(base, 'state.json'), state);
    await save(join(base, 'input.json'), manifest);
    console.log(
      JSON.stringify({
        prepared: true,
        privateDirectory: base,
        syntheticUsers: 1,
        orders: 0,
        sessions: 0,
      }),
    );
  } finally {
    await db.$disconnect();
  }
}

async function run(command: string, directory: string) {
  const base = resolve(directory),
    stat = await lstat(base);
  must(
    basename(base).startsWith('jlpt-year-license-') &&
      stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      (stat.mode & 0o077) === 0 &&
      stat.uid === process.getuid?.(),
    'PRIVATE_RUN_DIRECTORY_REQUIRED',
  );
  const state = stateSchema.parse(await privateJson(join(base, 'state.json')));
  databaseUrl(state.databaseUrl);
  const manifest = yearManifest.parse(
    await privateJson(join(base, 'input.json')),
  );
  must(
    JSON.stringify(manifest) === JSON.stringify(state.manifest),
    'MANIFEST_MISMATCH',
  );
  const exported = yearExport.parse(
    await privateJson(join(base, 'output.json')),
  );
  must(exported.runId === manifest.runId, 'EXPORT_RUN_MISMATCH');
  const token = exported.purchaseToken;
  const config = new ConfigService({
    DATABASE_URL: state.databaseUrl,
    BILLING_ENVIRONMENT: 'test',
    ANDROID_COMMERCE_ENVIRONMENT: 'test',
    GOOGLE_PLAY_PACKAGE_NAME: manifest.packageName,
    GOOGLE_PLAY_CREDENTIALS_FILE: state.credentialsFile,
    GOOGLE_PLAY_TOKEN_ENCRYPTION_KEY: state.encryptionKey,
  });
  const policy = new AndroidPolicy(config),
    gateway = new GoogleGateway(policy);
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: state.databaseUrl }),
  });
  try {
    const users = await db.user.findMany();
    must(
      users.length === 1 &&
        users[0].id === state.userId &&
        users[0].email === `${manifest.runId}@example.test` &&
        users[0].googlePlayAccountId === manifest.obfuscatedAccountId &&
        !users[0].deletedAt,
      'SYNTHETIC_DATABASE_OWNER_REQUIRED',
    );
    must(
      (await db.paymentOrder.count()) <= 1 &&
        (await db.googlePlayPurchase.count()) <= 1 &&
        (await db.entitlementGrant.count()) <= 1,
      'SINGLE_PURCHASE_DATABASE_REQUIRED',
    );
    const existingPin = await privateJson(join(base, 'verified-target.json'))
      .then((v) => yearPin.parse(v))
      .catch((e: unknown) => {
        if (
          command === 'inspect' &&
          (e as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return undefined;
        throw e;
      });
    if (existingPin)
      must(
        existingPin.runId === manifest.runId &&
          existingPin.tokenHash === tokenHash(token),
        'PINNED_EXPORT_REQUIRED',
      );
    const mode = command === 'reconcile-refund' ? 'refunded' : 'paid';
    async function fresh() {
      const purchase = await gateway.purchase(token);
      const orderId = purchase.orderId ?? existingPin?.googleOrderId;
      must(!!orderId, 'GOOGLE_ORDER_ID_REQUIRED');
      const order = await gateway.order(orderId!);
      const pin = guardYearPurchase(
        manifest,
        token,
        purchase,
        order,
        mode,
        existingPin,
      );
      return { purchase, order, pin };
    }
    const current = await fresh();
    if (command === 'inspect') {
      if (!existingPin)
        await save(join(base, 'verified-target.json'), current.pin);
      console.log(
        JSON.stringify({
          inspected: true,
          testContext: true,
          exactOwnerAndOffer: true,
          currency: 'JPY',
          amount: 9824,
          executed: false,
        }),
      );
      return;
    }
    must(!!existingPin, 'PRIOR_INSPECTION_REQUIRED');
    async function ledger(expected: 'paid' | 'refunded') {
      const rows = await db.googlePlayPurchase.findMany();
      const orders = await db.paymentOrder.findMany();
      const grants = await db.entitlementGrant.findMany();
      must(
        rows.length === 1 && orders.length === 1 && grants.length === 1,
        'EXACT_SINGLE_LEDGER_REQUIRED',
      );
      const row = rows[0],
        order = orders[0],
        grant = grants[0];
      must(
        row.tokenHash === existingPin!.tokenHash &&
          gateway.decrypt(row.tokenCiphertext) === token &&
          row.environment === 'test' &&
          row.packageName === manifest.packageName &&
          row.googleOrderId === existingPin!.googleOrderId &&
          row.productId === manifest.productId &&
          row.userId === state.userId &&
          row.orderId === order.id,
        'QUEUE_BINDING_REQUIRED',
      );
      must(
        order.provider === 'GOOGLE' &&
          order.environment === 'test' &&
          order.userId === state.userId &&
          order.providerOrderId ===
            `google:test:${existingPin!.googleOrderId}` &&
          order.productCode === 'YEAR_PASS' &&
          order.amount === 9824 &&
          order.currency === 'JPY' &&
          order.durationSeconds === 31536000 &&
          order.launchPrice,
        'YEAR_LEDGER_REQUIRED',
      );
      must(
        grant.userId === state.userId &&
          grant.source === 'GOOGLE_TEST' &&
          grant.orderId === order.id &&
          grant.durationSeconds === 31536000 &&
          grant.startsAt.getTime() ===
            Date.parse(existingPin!.completionTime) &&
          grant.endsAt.getTime() ===
            Date.parse(existingPin!.completionTime) + 31536000000,
        'EXACT_YEAR_INTERVAL_REQUIRED',
      );
      must(
        expected === 'paid'
          ? row.state === 'VERIFIED' &&
              row.consumeState === 'CONSUMED' &&
              order.status === 'PAID' &&
              order.refundedAmount === 0 &&
              grant.status === 'ACTIVE'
          : row.state === 'REFUNDED' &&
              row.consumeState === 'NOT_APPLICABLE' &&
              order.status === 'REFUNDED' &&
              order.refundedAmount === 9824 &&
              grant.status === 'REVOKED',
        'EXPECTED_LEDGER_STATE_REQUIRED',
      );
      return { row, order, grant };
    }
    if (
      command === 'prepare-refund' ||
      command === 'execute-approved-test-refund'
    ) {
      await ledger('paid');
      must(
        current.purchase.productLineItem[0].productOfferDetails
          ?.consumptionState === 'CONSUMPTION_STATE_CONSUMED',
        'FRESH_CONSUMED_REQUIRED',
      );
      const plan = {
        target: existingPin,
        preparedAt: new Date().toISOString(),
      };
      if (command === 'prepare-refund') {
        await save(join(base, 'refund-plan.json'), plan);
        console.log(
          JSON.stringify({
            ready: true,
            executed: false,
            testContext: true,
            amount: 9824,
            currency: 'JPY',
          }),
        );
        return;
      }
      const saved = z
        .object({ target: yearPin, preparedAt: z.string().datetime() })
        .parse(await privateJson(join(base, 'refund-plan.json')));
      must(
        JSON.stringify(saved.target) === JSON.stringify(existingPin) &&
          Date.now() - Date.parse(saved.preparedAt) < 3600000,
        'FRESH_PINNED_REFUND_PLAN_REQUIRED',
      );
      // Write an exclusive intent before the only provider mutation. An uncertain result must be inspected, never blindly repeated.
      await save(join(base, 'refund-attempt.json'), {
        at: new Date().toISOString(),
        target: existingPin,
      });
      await (
        gateway as unknown as {
          request(path: string, method: string): Promise<unknown>;
        }
      ).request(
        `orders/${encodeURIComponent(existingPin!.googleOrderId)}:refund?revoke=true`,
        'POST',
      );
      await save(join(base, 'refund-http-success.json'), {
        at: new Date().toISOString(),
        httpSuccess: true,
      });
      console.log(
        JSON.stringify({
          googleRefundHttpSuccess: true,
          ledgerNotModified: true,
        }),
      );
      return;
    }
    must(
      command === 'verify-consume-approved-test' ||
        command === 'reconcile-refund',
      'UNKNOWN_COMMAND',
    );
    const guarded = new GoogleGateway(policy);
    guarded.purchase = async (requested) => {
      must(requested === token, 'SINGLE_TOKEN_ONLY');
      return (await fresh()).purchase;
    };
    guarded.order = async (requested) => {
      must(requested === existingPin!.googleOrderId, 'SINGLE_ORDER_ONLY');
      return (await fresh()).order;
    };
    guarded.consume = async (product, requested) => {
      must(
        mode === 'paid' &&
          product === manifest.productId &&
          requested === token,
        'SINGLE_TEST_CONSUME_ONLY',
      );
      await fresh();
      await gateway.consume(product, requested);
    };
    const entitlements = new EntitlementService(config);
    const service = new GooglePurchaseService(
      db as PrismaService,
      policy,
      guarded,
      entitlements,
    );
    const queue = await service.enqueue(token);
    await service.reconcile(queue.id);
    const beforeReplay = await ledger(mode);
    await service.enqueue(token);
    await service.reconcile(queue.id);
    const afterReplay = await ledger(mode);
    must(
      beforeReplay.grant.endsAt.getTime() ===
        afterReplay.grant.endsAt.getTime(),
      'REPLAY_EXTENDED_ENTITLEMENT',
    );
    const final = await fresh();
    if (mode === 'paid')
      must(
        final.purchase.productLineItem[0].productOfferDetails
          ?.consumptionState === 'CONSUMPTION_STATE_CONSUMED',
        'FRESH_CONSUMED_REQUIRED',
      );
    const evidence = {
      at: new Date().toISOString(),
      mode,
      testContext: true,
      orders: 1,
      grants: 1,
      durationSeconds: 31536000,
      status: afterReplay.order.status,
      grantStatus: afterReplay.grant.status,
      consumption: afterReplay.row.consumeState,
      startsAt: afterReplay.grant.startsAt.toISOString(),
      endsAt: afterReplay.grant.endsAt.toISOString(),
      replayDidNotExtend: true,
    };
    await save(join(base, `${mode}-evidence-${Date.now()}.json`), evidence);
    console.log(JSON.stringify(evidence));
  } finally {
    await db.$disconnect();
  }
}
async function main() {
  const [command, directory, ...extra] = process.argv.slice(2);
  must(extra.length === 0, 'INVALID_ARGS');
  if (command === 'prepare' && !directory) return prepare();
  must(
    !!directory &&
      [
        'inspect',
        'verify-consume-approved-test',
        'prepare-refund',
        'execute-approved-test-refund',
        'reconcile-refund',
      ].includes(command),
    'EXPLICIT_COMMAND_REQUIRED',
  );
  await run(command, directory);
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'YEAR_LICENSE_GUARD_FAILED',
  );
  process.exitCode = 1;
});
