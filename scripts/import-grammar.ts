import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ImportsService } from '../src/imports/imports.service';

async function main() {
  const args = process.argv.slice(2);
  const fileFlag = args.indexOf('--file');
  const file = fileFlag >= 0 ? args[fileFlag + 1] : 'data/N1-N5语法总结-有解释例句.txt';
  const commit = args.includes('--commit');
  const content = await readFile(resolve(file), 'utf8');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const imports = app.get(ImportsService);
    const result = commit
      ? await imports.commit({ fileName: file.split('/').at(-1) ?? file, content })
      : await imports.dryRun({ fileName: file.split('/').at(-1) ?? file, content });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await app.close(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
