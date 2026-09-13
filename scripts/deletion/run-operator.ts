import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { deleteAccount } from './operator';

/** Not run against production in this task. No .env/autodetected connection. */
async function main() {
  const args = process.argv.slice(2);
  const values = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') {
      if (apply) throw Error('DUPLICATE_OPTION');
      apply = true;
      continue;
    }
    if (
      !['--user-id', '--review-file', '--report'].includes(args[i]) ||
      !args[i + 1] ||
      values.has(args[i])
    )
      throw Error('INVALID_OPTIONS');
    values.set(args[i], args[++i]);
  }
  const userId = values.get('--user-id');
  const connectionString = process.env.ACCOUNT_DELETION_DATABASE_URL;
  if (!userId || !connectionString)
    throw Error('EXPLICIT_CONNECTION_AND_ACCOUNT_REQUIRED');
  const reviewText = values.has('--review-file')
    ? await readFile(values.get('--review-file')!, 'utf8')
    : undefined;
  if (apply && (!reviewText || !values.has('--report')))
    throw Error('REVIEW_AND_NEW_PRIVATE_REPORT_REQUIRED');
  const review: unknown = reviewText ? JSON.parse(reviewText) : undefined;
  const report = values.has('--report')
    ? await open(values.get('--report')!, 'wx', 0o600)
    : undefined;
  const sql = new Client({ connectionString });
  try {
    // Write an intent before mutation; interrupted runs must inspect the tombstone.
    await report?.writeFile(
      JSON.stringify({
        status: 'STARTED',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        reviewDigest: reviewText
          ? createHash('sha256').update(reviewText).digest('hex')
          : null,
      }) + '\n',
    );
    await report?.sync();
    await sql.connect();
    const result = await deleteAccount(sql, userId, { apply, review });
    const serialized = JSON.stringify(result, null, 2) + '\n';
    if (report) {
      await report.writeFile(JSON.stringify(result) + '\n');
      await report.sync();
    } else console.log(serialized);
  } finally {
    await sql.end();
    await report?.close();
  }
}
void main().catch(() => {
  console.error(
    'ACCOUNT_DELETION_NOT_CONFIRMED_REVIEW_PRIVATE_REPORT_AND_DATABASE',
  );
  process.exitCode = 1;
});
