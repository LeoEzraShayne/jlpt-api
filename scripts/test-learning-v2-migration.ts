/** Creates and removes only its own randomly named local PostgreSQL database. */
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from 'pg';

const adminUrl = new URL(
  process.env.TEST_DATABASE_ADMIN_URL ??
    `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`,
);
if (!['localhost', '127.0.0.1', '[::1]'].includes(adminUrl.hostname)) {
  throw new Error('Migration rehearsal only accepts a local PostgreSQL server');
}
const database = `jlpt_v2_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const admin = new Client({ connectionString: adminUrl.toString() });
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${database}`;
let created = false;
const db = new Client({ connectionString: testUrl.toString() });

async function migration(name: string) {
  const sql = await readFile(
    path.join('prisma/migrations', name, 'migration.sql'),
    'utf8',
  );
  await db.query(sql);
}
async function concurrentCurrentPlans() {
  const clients = Array.from(
    { length: 4 },
    () => new Client({ connectionString: testUrl.toString() }),
  );
  try {
    await Promise.all(clients.map((c) => c.connect()));
    const results = await Promise.allSettled(
      clients.map((c, i) =>
        c.query(
          `
      INSERT INTO "StudyPlan" (id,"userId",level,"startDate","targetDate","dailyMinutes","dailyNewLimit",status,"updatedAt")
      VALUES ($1,'migration-old','N3',now(),now()+interval '60 days',30,2,'ACTIVE',now())`,
          [`concurrent-${i}`],
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results)
      if (r.status === 'rejected') assert.equal(r.reason.code, '23505');
    // A paused plan continues to occupy its level. History does not.
    await db.query(
      `UPDATE "StudyPlan" SET status='PAUSED' WHERE "userId"='migration-old' AND level='N3'`,
    );
    await assert.rejects(
      () =>
        db.query(`
      INSERT INTO "StudyPlan" (id,"userId",level,"startDate","targetDate","dailyMinutes","dailyNewLimit",status,"updatedAt")
      VALUES ('paused-collision','migration-old','N3',now(),now(),30,2,'ACTIVE',now())`),
      { code: '23505' },
    );
    await db.query(
      `UPDATE "StudyPlan" SET status='ARCHIVED' WHERE "userId"='migration-old' AND level='N3'`,
    );
    await db.query(`INSERT INTO "StudyPlan" (id,"userId",level,"startDate","targetDate","dailyMinutes","dailyNewLimit",status,"updatedAt")
      VALUES ('after-archive','migration-old','N3',now(),now(),30,2,'ACTIVE',now())`);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}
async function constraints() {
  await assert.rejects(
    () =>
      db.query(`UPDATE "User" SET "primaryShare"=101 WHERE id='migration-old'`),
    { code: '23514' },
  );
  await assert.rejects(
    () =>
      db.query(`INSERT INTO "StudyTask" (id,"userId","grammarId","taskDate",type,status,"idempotencyKey")
    VALUES ('duplicate-null-progress','migration-old','migration-grammar',now(),'REVIEW','PENDING','third-duplicate')`),
    { code: '23505' },
  );
}

async function main() {
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    await db.connect();
    const migrations = (await readdir('prisma/migrations'))
      .filter((n) => /^\d/.test(n))
      .sort();
    const firstV2 = '202609100002_learning_v2_enums';
    for (const name of migrations.filter((n) => n < firstV2))
      await migration(name);
    await db.query(
      await readFile('test/fixtures/learning-v2-legacy.sql', 'utf8'),
    );
    for (const name of migrations.filter((n) => n >= firstV2))
      await migration(name);
    await db.query(
      await readFile('test/fixtures/learning-v2-assert.sql', 'utf8'),
    );
    await concurrentCurrentPlans();
    await constraints();
    console.log(
      'PASS: legacy migration, preserved history/budget, paused plans, concurrent uniqueness and review deduplication',
    );
  } finally {
    await db.end().catch(() => undefined);
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
}
void main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
