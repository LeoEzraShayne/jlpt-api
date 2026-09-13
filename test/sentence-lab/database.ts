import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import { readdir, readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/** Never reads .env, never reuses a learning DB, and only drops its own random DB. */
export async function acceptanceDatabase(
  options: { stopBeforeMigration?: string } = {},
) {
  const adminUrl = new URL(
    process.env.TEST_DATABASE_ADMIN_URL ??
      `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`,
  );
  if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname))
    throw new Error('LOCAL_TEST_POSTGRES_REQUIRED');
  const name = `jlpt_f_acceptance_test_${Date.now()}_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${name}"`);
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const sql = new Client({ connectionString: url.toString() });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url.toString() }),
  });
  const stop = async () => {
    await prisma.$disconnect();
    await sql.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  };
  try {
    await sql.connect();
    const migrations = (await readdir('prisma/migrations'))
      .filter((n) => /^\d/.test(n))
      .sort();
    if (
      options.stopBeforeMigration &&
      !migrations.includes(options.stopBeforeMigration)
    )
      throw new Error('UNKNOWN_MIGRATION_BOUNDARY');
    for (const migration of migrations) {
      if (migration === options.stopBeforeMigration) break;
      await sql.query(
        await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
      );
    }
    await prisma.$connect();
    return { prisma, sql, stop, connectionString: url.toString() };
  } catch (error) {
    await stop();
    throw error;
  }
}
export type AcceptanceDatabase = Awaited<ReturnType<typeof acceptanceDatabase>>;
