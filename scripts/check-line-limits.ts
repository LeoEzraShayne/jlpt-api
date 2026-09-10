import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function collect(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => entry.name !== 'generated').map((entry) => entry.isDirectory() ? collect(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat().filter((file) => file.endsWith('.ts'));
}

async function main() {
  const files = [...await collect('src'), ...await collect('scripts')];
  const failures: string[] = [];
  for (const file of files) {
    const lines = (await readFile(file, 'utf8')).split('\n').length;
    if (lines > 500) failures.push(`${file}: ${lines}`);
  }
  if (failures.length) throw new Error(`Files exceed 500 lines:\n${failures.join('\n')}`);
  process.stdout.write(`Checked ${files.length} files; all are within 500 lines.\n`);
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
