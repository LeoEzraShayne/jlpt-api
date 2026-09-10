import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { RecallRating } from '@prisma/client';
import { AdminGuard } from '../auth/admin.guard';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../database/prisma.service';

class AlgorithmMetricsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) days = 30;
}

@Controller('admin/review-algorithm')
@UseGuards(SessionGuard, AdminGuard)
export class ReviewAlgorithmController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('metrics')
  async metrics(@Query() query: AlgorithmMetricsQueryDto) {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const [events, overdueCount, openTaskCount, tasksByStatus] =
      await Promise.all([
        this.prisma.reviewEvent.findMany({
          where: { reviewedAt: { gte: since } },
          select: {
            userId: true,
            effectiveRating: true,
            aiEvidence: true,
            retrievabilityBefore: true,
            scheduledDaysAfter: true,
            algorithmVersion: true,
          },
          orderBy: { reviewedAt: 'desc' },
          take: 10_000,
        }),
        this.prisma.reviewSchedule.count({
          where: {
            OR: [
              { nextReviewOn: { lte: new Date() } },
              { nextReviewOn: null, nextReviewAt: { lte: new Date() } },
            ],
          },
        }),
        this.prisma.studyTask.count({
          where: {
            type: 'REVIEW',
            status: { in: ['PENDING', 'IN_PROGRESS'] },
          },
        }),
        this.prisma.studyTask.groupBy({
          by: ['status'],
          where: { type: 'REVIEW', createdAt: { gte: since } },
          _count: { _all: true },
        }),
      ]);
    const rated = events.filter((event) => event.retrievabilityBefore !== null);
    const brierScore = rated.length
      ? rated.reduce((sum, event) => {
          const actual =
            event.effectiveRating === RecallRating.REMEMBERED ? 1 : 0;
          return sum + (event.retrievabilityBefore! - actual) ** 2;
        }, 0) / rated.length
      : null;
    const buckets = Array.from({ length: 10 }, (_, index) => {
      const lower = index / 10;
      const upper = (index + 1) / 10;
      const values = rated.filter((event) => {
        const predicted = event.retrievabilityBefore!;
        return (
          predicted >= lower &&
          (index === 9 ? predicted <= 1 : predicted < upper)
        );
      });
      return {
        lower,
        upper,
        count: values.length,
        predictedAverage: average(
          values.map((event) => event.retrievabilityBefore!),
        ),
        rememberedRate: values.length
          ? values.filter(
              (event) => event.effectiveRating === RecallRating.REMEMBERED,
            ).length / values.length
          : null,
      };
    });
    return {
      data: {
        days: query.days,
        eventCount: events.length,
        ratingDistribution: countBy(
          events.map((event) => event.effectiveRating),
        ),
        aiEvidenceDistribution: countBy(
          events.map((event) => event.aiEvidence),
        ),
        algorithmDistribution: countBy(
          events.map((event) => event.algorithmVersion),
        ),
        averageIntervalDays: average(
          events.map((event) => event.scheduledDaysAfter),
        ),
        overdueCount,
        openTaskCount,
        tasksByStatus: Object.fromEntries(
          tasksByStatus.map((item) => [item.status, item._count._all]),
        ),
        brierScore,
        calibrationBuckets: buckets,
        calibrationReady:
          events.length >= 10_000 &&
          new Set(events.map((event) => event.userId)).size >= 100,
      },
    };
  }
}

function countBy(values: string[]) {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}
