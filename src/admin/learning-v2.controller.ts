import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { SessionGuard } from '../auth/session.guard';
import { AdminGuard } from '../auth/admin.guard';
import { PrismaService } from '../database/prisma.service';

class RolloutDto {
  @IsBoolean() enabled!: boolean;
}
class MetricsDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days = 7;
}

@Controller('admin/learning-v2')
@UseGuards(SessionGuard, AdminGuard)
export class LearningV2Controller {
  constructor(private readonly prisma: PrismaService) {}

  @Patch('users/:id')
  async rollout(@Param('id') id: string, @Body() dto: RolloutDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return {
      data: await this.prisma.user.update({
        where: { id },
        data: { learningV2Enabled: dto.enabled },
        select: { id: true, learningV2Enabled: true },
      }),
    };
  }

  @Get('metrics')
  async metrics(@Query() query: MetricsDto) {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const [
      jobs,
      results,
      events,
      enabledAccounts,
      duplicates,
      overruns,
      mismatchedEvidence,
    ] = await Promise.all([
      this.prisma.aiReviewJob.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.aiReviewResult.findMany({
        where: { createdAt: { gte: since } },
        select: { latencyMs: true, inputTokens: true, outputTokens: true },
        take: 10_000,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.reviewEvent.findMany({
        where: { reviewedAt: { gte: since }, evidenceVersion: 'mastery-v2' },
        select: {
          dueReview: true,
          firstScore: true,
          targetGrammarCorrect: true,
          hintRevealCount: true,
          effectiveRating: true,
          stabilityBefore: true,
          crossScenarioValid: true,
          scenarioTaskCompleted: true,
        },
        take: 10_000,
        orderBy: { reviewedAt: 'desc' },
      }),
      this.prisma.user.count({ where: { learningV2Enabled: true } }),
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM (
          SELECT "userId", "grammarId" FROM "StudyTask"
          WHERE type = 'REVIEW' AND status IN ('PENDING','IN_PROGRESS')
            AND "grammarId" IS NOT NULL
          GROUP BY "userId", "grammarId" HAVING count(*) > 1
        ) duplicates`,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM "DailyStudyStat" d JOIN "User" u ON u.id = d."userId"
          WHERE d."studyDate" = (now() AT TIME ZONE u.timezone)::date
            AND d."studyMinutes" > u."dailyMinutes"`,
      this.prisma.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) FROM "ReviewEvent" e JOIN "StudySession" s ON s.id = e."sessionId"
          WHERE e."reviewedAt" >= ${since}
            AND (e."grammarId" <> s."grammarId" OR e."userId" <> s."userId")`,
    ]);
    const latency = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    return {
      data: {
        days: query.days,
        enabledAccounts,
        sampleLimit: 10_000,
        jobsByStatus: Object.fromEntries(jobs.map((j) => [j.status, j._count])),
        latencyMs: {
          p50: percentile(latency, 0.5),
          p95: percentile(latency, 0.95),
        },
        tokenUsage: results.reduce(
          (sum, r) => ({
            input: sum.input + (r.inputTokens ?? 0),
            output: sum.output + (r.outputTokens ?? 0),
          }),
          { input: 0, output: 0 },
        ),
        duplicateOpenReviews: Number(duplicates[0]?.count ?? 0),
        dailyBudgetOverrunAccounts: Number(overruns[0]?.count ?? 0),
        targetEvidenceMismatchCount: Number(mismatchedEvidence[0]?.count ?? 0),
        evidenceCount: events.length,
        lapseAfterStableMemoryCount: events.filter(
          (e) =>
            (e.stabilityBefore ?? 0) >= 30 && e.effectiveRating === 'FORGOT',
        ).length,
        invalidTransferEvidenceCount: events.filter(
          (e) => e.crossScenarioValid && !e.scenarioTaskCompleted,
        ).length,
        memoryImprovementValidated: false,
      },
    };
  }
}
function percentile(values: number[], fraction: number) {
  return values.length
    ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)]
    : null;
}
