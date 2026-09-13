/** Read-only diagnostic for a private captured callback; never prints the query or secrets. */
import 'reflect-metadata';
import { lstat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { userInfo } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import {
  AdmobVerifier,
  parseSsv,
} from '../../src/android-commerce/admob-verifier';

async function privateRead(path: string) {
  const stat = await lstat(path);
  if (
    !isAbsolute(path) ||
    !stat.isFile() ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid?.()
  )
    throw new Error('PRIVATE_FILE_REQUIRED');
  return readFile(path, 'utf8');
}
async function main() {
  const { values } = parseArgs({
    options: {
      'query-file': { type: 'string' },
      'state-dir': { type: 'string' },
    },
  });
  if (!values['query-file'] || !values['state-dir'])
    throw new Error('DIAGNOSTIC_PATHS_REQUIRED');
  const raw = (await privateRead(values['query-file'])).trim();
  const query =
    raw.startsWith('https://') || raw.startsWith('/')
      ? raw.slice(raw.indexOf('?') + 1)
      : raw;
  const state = JSON.parse(
    await privateRead(join(values['state-dir'], 'state.json')),
  ) as { databaseName: string };
  if (!/^jlpt_f_acceptance_test_\d+_[a-f0-9]+$/.test(state.databaseName))
    throw new Error('ISOLATED_DATABASE_REQUIRED');
  let parsed: ReturnType<typeof parseSsv>;
  try {
    parsed = parseSsv(query);
  } catch {
    console.log(JSON.stringify({ parse: false }));
    return;
  }
  let verified = false;
  try {
    await new AdmobVerifier().verify(query);
    verified = true;
  } catch {
    /* Safe boolean only. */
  }
  const fields = parsed.fields;
  const client = new Client({
    connectionString: `postgres://${encodeURIComponent(userInfo().username)}@localhost:5432/${state.databaseName}`,
  });
  await client.connect();
  try {
    const result = await client.query<{
      environment: string;
      ssvUserId: string;
      ssvAdUnitId: string;
      rewardItem: string;
      status: string;
      issuedMillis: string;
      expiresMillis: string;
    }>(
      `SELECT "environment", "ssvUserId", "ssvAdUnitId", "rewardItem", EXTRACT(EPOCH FROM ("issuedAt" AT TIME ZONE 'UTC'))*1000 AS "issuedMillis", EXTRACT(EPOCH FROM ("expiresAt" AT TIME ZONE 'UTC'))*1000 AS "expiresMillis", "status" FROM "RewardTicket" WHERE "secretHash"=$1`,
      [
        createHash('sha256')
          .update(fields.custom_data ?? '')
          .digest('hex'),
      ],
    );
    const ticket = result.rows[0];
    const timestamp = Number(fields.timestamp);
    console.log(
      JSON.stringify({
        parse: true,
        signatureVerified: verified,
        fieldNames: Object.keys(fields),
        ticketFound: !!ticket,
        ticketStatus: ticket?.status ?? null,
        adUnit: fields.ad_unit,
        rewardItem: fields.reward_item,
        rewardAmount: fields.reward_amount,
        customDataFormat: /^[A-Za-z0-9_-]{43}$/.test(fields.custom_data ?? ''),
        transactionFormat: /^[A-Za-z0-9_-]{1,200}$/.test(
          fields.transaction_id ?? '',
        ),
        timestampInteger:
          /^\d+$/.test(fields.timestamp ?? '') &&
          Number.isSafeInteger(timestamp),
        timestampAgeSeconds: Number.isSafeInteger(timestamp)
          ? Math.round((Date.now() - timestamp) / 1000)
          : null,
        aliasMatches: ticket ? ticket.ssvUserId === fields.user_id : null,
        adUnitMatches: ticket ? ticket.ssvAdUnitId === fields.ad_unit : null,
        rewardItemMatches: ticket
          ? ticket.rewardItem === fields.reward_item
          : null,
        environmentMatches: ticket ? ticket.environment === 'test' : null,
        earnedWithinWindow: ticket
          ? timestamp >= Number(ticket.issuedMillis) - 60000 &&
            timestamp <= Number(ticket.expiresMillis) + 60000
          : null,
      }),
    );
  } finally {
    await client.end();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : 'DIAGNOSTIC_FAILED');
  process.exitCode = 1;
});
