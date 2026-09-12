import { nextCalendarDate } from '../study-plans/study-plan-dates';
import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JlptLevel, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { SessionGuard } from '../auth/session.guard';
import { localDayUtcRange } from '../dashboard/dashboard-statistics';
import { localDate } from '../dashboard/dashboard.service';
import {
  addCalendarDays,
  calendarDayDifference,
  estimatedRetrievability,
} from './adaptive-review';
import {
  reviewMinutes,
  sortReviewCandidates,
} from '../dashboard/task-planning';
import { PrismaService } from '../database/prisma.service';
import {
  ContentLocalizationService,
  contentLocale,
} from '../content-localization/content-localization.service';

class ReviewQueueQueryDto {
  @IsOptional() @IsEnum(JlptLevel) level?: JlptLevel;
  @IsOptional() @IsIn(['active', 'all']) scope?: 'active' | 'all';
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  upcomingDays = 7;
}

@Controller('review-queue')
@UseGuards(SessionGuard)
export class ReviewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localization: ContentLocalizationService,
  ) {}

  @Get()
  async getQueue(@Req() request: Request, @Query() query: ReviewQueueQueryDto) {
    const user = request.currentUser!;
    const plans =
      query.scope === 'all'
        ? null
        : await this.prisma.studyPlan.findMany({
            where: {
              userId: user.id,
              status: 'ACTIVE',
              startDate: {
                lt: nextCalendarDate(localDate(user.timezone).value),
              },
            },
            select: { level: true },
          });
    const todayKey = localDate(user.timezone).key;
    const upperKey = addCalendarDays(todayKey, query.upcomingDays);
    const upperDate = new Date(`${upperKey}T00:00:00.000Z`);
    const upperExclusive = localDayUtcRange(upperKey, user.timezone).end;
    const where: Prisma.ReviewScheduleWhereInput = {
      progress: {
        userId: user.id,
        grammar: {
          status: 'PUBLISHED',
          level: plans
            ? {
                in: plans
                  .map((plan) => plan.level)
                  .filter((level) => !query.level || level === query.level),
              }
            : query.level,
        },
      },
      OR: [
        { nextReviewOn: { lte: upperDate } },
        { nextReviewOn: null, nextReviewAt: { lt: upperExclusive } },
      ],
    };
    const [items, countItems] = await Promise.all([
      this.prisma.reviewSchedule.findMany({
        where,
        include: { progress: { include: { grammar: true } } },
        orderBy: [
          { nextReviewOn: 'asc' },
          { nextReviewAt: 'asc' },
          { id: 'asc' },
        ],
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
        take: query.limit + 1,
      }),
      this.prisma.reviewSchedule.findMany({
        where,
        select: { nextReviewOn: true, nextReviewAt: true },
      }),
    ]);
    const hasMore = items.length > query.limit;
    if (hasMore) items.pop();
    const grammars = await this.localization.grammar(
      items.map((item) => item.progress.grammar),
      contentLocale(user.explanationLocale),
    );
    const byId = new Map(grammars.map((grammar) => [grammar.id, grammar]));
    const sorted = sortReviewCandidates(
      items.map((item) => ({
        item,
        grammarId: item.progress.grammarId,
        nextReviewAt: item.nextReviewAt,
        priorityDay: item.nextReviewOn
          ? item.nextReviewOn.toISOString().slice(0, 10)
          : localDate(user.timezone, item.nextReviewAt).key,
        status: item.progress.status,
        masteryScore: item.progress.masteryScore,
        lastScore: item.progress.lastScore,
        stability: item.stability,
        estimatedRetrievability: safeRetrievability(item),
      })),
    );
    const counts = countQueueGroups(countItems, todayKey, user.timezone);
    return {
      data: sorted.map(({ item, ...candidate }) => {
        const dueKey = item.nextReviewOn
          ? item.nextReviewOn.toISOString().slice(0, 10)
          : localDate(user.timezone, item.nextReviewAt).key;
        const group =
          dueKey < todayKey
            ? 'OVERDUE'
            : dueKey === todayKey
              ? 'DUE_TODAY'
              : 'UPCOMING';
        return {
          ...item,
          progress: {
            ...item.progress,
            grammar: byId.get(item.progress.grammarId)!,
          },
          nextReviewOn: dueKey,
          estimatedRetrievability: candidate.estimatedRetrievability,
          isEstimate: true,
          group,
          overdueDays: Math.max(0, calendarDayDifference(dueKey, todayKey)),
          estimatedMinutes: reviewMinutes(candidate),
        };
      }),
      meta: {
        nextCursor: hasMore ? items.at(-1)?.id : null,
        counts,
        scope: query.scope ?? 'active',
        upcomingDays: query.upcomingDays,
      },
    };
  }
}

function countQueueGroups(
  items: Array<{ nextReviewOn: Date | null; nextReviewAt: Date }>,
  todayKey: string,
  timezone: string,
) {
  const counts = { overdue: 0, dueToday: 0, upcoming: 0 };
  for (const item of items) {
    const dueKey = item.nextReviewOn
      ? item.nextReviewOn.toISOString().slice(0, 10)
      : localDate(timezone, item.nextReviewAt).key;
    if (dueKey < todayKey) counts.overdue += 1;
    else if (dueKey === todayKey) counts.dueToday += 1;
    else counts.upcoming += 1;
  }
  return counts;
}

function safeRetrievability(
  schedule: Parameters<typeof estimatedRetrievability>[0],
) {
  try {
    return estimatedRetrievability(schedule);
  } catch {
    return null;
  }
}
