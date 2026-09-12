import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  sourceCorrectionSchema,
  applySourceCorrection,
  correctedSnapshot,
} from '../../src/content-localization/source-correction';
import { arg, args, database } from './io';
async function main() {
  const plan = sourceCorrectionSchema.parse(
    JSON.parse(
      await readFile(
        arg(
          '--file',
          'scripts/content-localization/corrections/F-language-20260913.json',
        ),
        'utf8',
      ),
    ),
  );
  if (arg('--snapshot')) {
    const input = arg('--snapshot'),
      output = arg('--output');
    if (!output || resolve(input) === resolve(output))
      throw Error('DISTINCT_OUTPUT_SNAPSHOT_REQUIRED');
    const snapshot = JSON.parse(await readFile(input, 'utf8')) as Record<
      string,
      Record<string, unknown>[]
    >;
    await writeFile(
      output,
      JSON.stringify(correctedSnapshot(snapshot, plan), null, 2) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        correctedSnapshot: true,
        sourcePatches: plan.sourcePatches.length,
      }),
    );
    return;
  }
  const db = database();
  try {
    const result = await db.$transaction(
      (tx) => applySourceCorrection(tx, plan, args.includes('--commit')),
      { timeout: 30000 },
    );
    console.log(JSON.stringify(result));
  } finally {
    await db.$disconnect();
  }
}
main().catch((e: unknown) => {
  console.error(
    e instanceof Error && /^[A-Z_]+$/.test(e.message)
      ? e.message
      : 'SOURCE_CORRECTION_FAILED',
  );
  process.exitCode = 1;
});
