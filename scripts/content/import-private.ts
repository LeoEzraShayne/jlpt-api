import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { PrismaService } from '../../src/database/prisma.service';
import { ContentImportService } from '../../src/content/content-import.service';
import { PreviewImportDto } from '../../src/content/content.dto';

async function main() {
  const userIndex = process.argv.indexOf('--user-id');
  const userId = userIndex >= 0 ? process.argv[userIndex + 1] : undefined;
  const path = process.argv[2];
  if (!path)
    throw new Error(
      'Usage: tsx scripts/content/import-private.ts preview.json [--stage --user-id ID]',
    );
  const dto = plainToInstance(
    PreviewImportDto,
    JSON.parse(await readFile(path, 'utf8')),
  );
  await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (!process.argv.includes('--stage')) {
    console.log(
      JSON.stringify({ valid: true, rows: dto.rows.length, staged: false }),
    );
    return;
  }
  if (!userId)
    throw new Error('--stage requires explicit --user-id; no default account');
  const db = new PrismaService(new ConfigService());
  try {
    if (
      !(await db.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }))
    )
      throw new Error('User does not exist');
    const result = await new ContentImportService(db).preview(userId, dto);
    console.log(
      JSON.stringify({
        importId: result.id,
        inserted: result.inserted,
        duplicates: result.duplicates,
        status: result.status,
        visibility: 'PRIVATE',
      }),
    );
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Input validation failed',
  );
  process.exitCode = 1;
});
