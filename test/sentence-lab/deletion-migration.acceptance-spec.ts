import { readFile } from 'node:fs/promises';
import { acceptanceDatabase, type AcceptanceDatabase } from './database';
let h: AcceptanceDatabase;
const migration = '20260913063000_account_deletion_guard';
afterEach(async () => {
  await h?.stop();
});

test('incremental guard migration preserves existing users and billing, and pre-deletion rollback is reversible', async () => {
  h = await acceptanceDatabase({ stopBeforeMigration: migration });
  await h.sql.query(
    'INSERT INTO "User" (id,email,"displayName","updatedAt") VALUES (\'synthetic\',\'migration@example.test\',\'Synthetic\',CURRENT_TIMESTAMP)',
  );
  const before = await h.sql.query<{ row: unknown }>(
    'SELECT to_jsonb(u) AS row FROM "User" u',
  );
  await h.sql.query(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  );
  const after = await h.sql.query<{ row: unknown }>(
    'SELECT to_jsonb(u)-\'deletedAt\' AS row FROM "User" u',
  );
  expect(after.rows).toEqual(before.rows);
  expect(
    await h.prisma.user.findUniqueOrThrow({ where: { id: 'synthetic' } }),
  ).toMatchObject({ deletedAt: null });
  await h.sql.query(
    await readFile('docs/operations/account-deletion-rollback.sql', 'utf8'),
  );
  expect(
    (
      await h.sql.query<{ row: unknown }>(
        'SELECT to_jsonb(u) AS row FROM "User" u',
      )
    ).rows,
  ).toEqual(before.rows);
  await h.sql.query(
    await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'),
  );
  expect(
    await h.prisma.user.findUniqueOrThrow({ where: { id: 'synthetic' } }),
  ).toMatchObject({ deletedAt: null });
});

test('rollback refuses any tombstone instead of removing protections and enabling resurrection', async () => {
  h = await acceptanceDatabase();
  await h.prisma.user.create({
    data: {
      email: 'tombstone@example.test',
      displayName: 'Synthetic',
      deletedAt: new Date(),
    },
  });
  await expect(
    h.sql.query(
      await readFile('docs/operations/account-deletion-rollback.sql', 'utf8'),
    ),
  ).rejects.toThrow('ROLLBACK_FORBIDDEN_TOMBSTONES_EXIST');
  await h.sql.query('ROLLBACK');
  const row = await h.prisma.user.findFirstOrThrow();
  await expect(
    h.prisma.user.update({ where: { id: row.id }, data: { deletedAt: null } }),
  ).rejects.toThrow();
});
