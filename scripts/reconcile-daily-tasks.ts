import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { DashboardService } from '../src/dashboard/dashboard.service';
import type { PrismaService } from '../src/database/prisma.service';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
  try {
    const plans = await prisma.studyPlan.findMany({
      where: { status: 'ACTIVE' },
      include: { user: { select: { id: true, timezone: true } } },
      distinct: ['userId'],
      orderBy: { updatedAt: 'desc' },
    });
    const dashboard = new DashboardService(prisma as PrismaService);
    for (const plan of plans)
      await dashboard.ensureDailyTasks(plan.user.id, plan.user.timezone);
    process.stdout.write(
      `Reconciled daily tasks for ${plans.length} active users.\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `Daily task reconciliation failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
