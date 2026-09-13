import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDeletionFixture,
  syntheticReview,
} from '../../scripts/deletion/synthetic-rehearsal';
import type { DeletionReport } from '../../scripts/deletion/operator';
const execute = promisify(execFile);

test('real operator CLI defaults to dry-run, requires a reviewed plan, and writes a new 0600 audit file for synthetic apply', async () => {
  const f = await createDeletionFixture();
  const folder = await mkdtemp(join(tmpdir(), 'jlpt-deletion-cli-synthetic-'));
  const preview = join(folder, 'preview.jsonl'),
    result = join(folder, 'result.jsonl'),
    review = join(folder, 'review.json');
  const run = (args: string[]) =>
    execute(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/deletion/run-operator.ts',
        '--user-id',
        f.user.id,
        ...args,
      ],
      {
        env: {
          PATH: process.env.PATH,
          ACCOUNT_DELETION_DATABASE_URL: f.h.connectionString,
        },
      },
    );
  try {
    await run(['--report', preview]);
    expect(
      (await f.h.prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
        .deletedAt,
    ).toBeNull();
    const rows = (await readFile(preview, 'utf8')).trim().split('\n');
    const planned = JSON.parse(rows[1]) as DeletionReport;
    expect(planned.mode).toBe('DRY_RUN');
    await expect(run(['--apply', '--report', result])).rejects.toThrow();
    await writeFile(
      review,
      JSON.stringify({
        ...syntheticReview(f.user.id),
        planDigest: planned.planDigest,
      }),
      { mode: 0o600 },
    );
    await run(['--apply', '--review-file', review, '--report', result]);
    const applied = JSON.parse(
      (await readFile(result, 'utf8')).trim().split('\n')[1],
    ) as DeletionReport;
    expect(applied.mode).toBe('APPLIED');
    expect(applied.completedAt).toBeTruthy();
    expect((await stat(result)).mode & 0o777).toBe(0o600);
    expect(
      (await f.h.prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }))
        .deletedAt,
    ).not.toBeNull();
    await expect(
      run(['--apply', '--review-file', review, '--report', result]),
    ).rejects.toThrow();
  } finally {
    await f.h.stop();
    await rm(folder, { recursive: true, force: true });
  }
});
