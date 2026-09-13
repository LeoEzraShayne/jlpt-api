import { createDeletionFixture, rehearseDeletion } from './synthetic-rehearsal';

async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--apply-synthetic'))
    throw new Error(
      'ONLY_OPTION_IS_APPLY_SYNTHETIC_NO_DATABASE_OR_ACCOUNT_SELECTOR',
    );
  const { h } = await createDeletionFixture();
  try {
    console.log(
      JSON.stringify(
        await rehearseDeletion(h, {
          applySynthetic: args.includes('--apply-synthetic'),
        }),
        null,
        2,
      ),
    );
  } finally {
    await h.stop();
  }
}
void main().catch(() => {
  console.error('SYNTHETIC_REHEARSAL_FAILED_NO_PRODUCTION_ACTION');
  process.exitCode = 1;
});
