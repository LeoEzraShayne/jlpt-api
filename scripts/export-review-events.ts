import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const events = await prisma.reviewEvent.findMany({
      where: { affectsSchedule: true },
      select: {
        userId: true,
        grammarId: true,
        reviewedAt: true,
        elapsedDays: true,
        effectiveRating: true,
        retrievabilityBefore: true,
        stabilityBefore: true,
        difficultyBefore: true,
        algorithmVersion: true,
      },
      orderBy: [{ userId: 'asc' }, { grammarId: 'asc' }, { reviewedAt: 'asc' }],
    });
    process.stdout.write(
      'user_key,item_key,reviewed_at,elapsed_days,rating,retrievability_before,stability_before,difficulty_before,algorithm_version\n',
    );
    for (const event of events)
      process.stdout.write(
        [
          anonymousKey(event.userId),
          anonymousKey(event.grammarId),
          event.reviewedAt.toISOString(),
          event.elapsedDays,
          event.effectiveRating,
          event.retrievabilityBefore ?? '',
          event.stabilityBefore ?? '',
          event.difficultyBefore ?? '',
          event.algorithmVersion,
        ]
          .map(csvCell)
          .join(',') + '\n',
      );
  } finally {
    await prisma.$disconnect();
  }
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function anonymousKey(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Review event export failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
