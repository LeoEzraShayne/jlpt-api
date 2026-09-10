import { Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, JlptLevel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  estimatedRetrievability,
  localDateKey,
} from '../review/adaptive-review';

export interface GrammarQuery {
  level?: JlptLevel;
  status?: ContentStatus;
  query?: string;
  cursor?: string;
  limit?: number;
}

@Injectable()
export class GrammarService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(input: GrammarQuery, userId: string, timezone: string) {
    const limit = Math.min(input.limit ?? 30, 100);
    const items = await this.prisma.grammarPoint.findMany({
      where: {
        level: input.level,
        status: input.status ?? ContentStatus.PUBLISHED,
        ...(input.query
          ? {
              OR: [
                { title: { contains: input.query, mode: 'insensitive' } },
                {
                  chineseExplanation: {
                    contains: input.query,
                    mode: 'insensitive',
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        examples: { orderBy: { sortOrder: 'asc' }, take: 1 },
        progress: {
          where: { userId },
          include: { schedule: true },
          take: 1,
        },
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      cursor: input.cursor ? { id: input.cursor } : undefined,
      skip: input.cursor ? 1 : 0,
      take: limit + 1,
    });
    const hasMore = items.length > limit;
    if (hasMore) items.pop();
    return {
      items: items.map((item) => this.withLearningState(item, timezone)),
      nextCursor: hasMore ? items.at(-1)?.id : null,
    };
  }

  async findOne(id: string, userId: string, timezone: string) {
    const item = await this.prisma.grammarPoint.findUnique({
      where: { id },
      include: {
        examples: { orderBy: { sortOrder: 'asc' } },
        progress: {
          where: { userId },
          include: { schedule: true },
          take: 1,
        },
        sentenceAttempts: {
          where: { userId },
          include: { aiJob: { include: { result: true } } },
          orderBy: { createdAt: 'desc' },
          take: 3,
        },
        relationMembers: {
          include: {
            group: {
              include: {
                members: {
                  include: { grammar: { select: { id: true, title: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!item)
      throw new NotFoundException({
        code: 'GRAMMAR_NOT_FOUND',
        message: 'Grammar point not found',
      });
    return this.withLearningState(item, timezone);
  }

  async markNeedsWork(grammarId: string, userId: string, needsWork: boolean) {
    const grammar = await this.prisma.grammarPoint.findFirst({
      where: { id: grammarId, status: 'PUBLISHED' },
    });
    if (!grammar)
      throw new NotFoundException({
        code: 'GRAMMAR_NOT_FOUND',
        message: 'Grammar point not found',
      });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const current = await tx.userGrammarProgress.findUnique({
        where: { userId_grammarId: { userId, grammarId } },
      });
      const progress = await tx.userGrammarProgress.upsert({
        where: { userId_grammarId: { userId, grammarId } },
        create: { userId, grammarId, needsWork, status: 'NOT_STARTED' },
        update: {
          needsWork,
          ...(needsWork && current?.status !== 'NOT_STARTED'
            ? { status: 'NEEDS_WORK' }
            : {}),
        },
      });
      if (needsWork) {
        const date = new Date(`${localDateKey(user.timezone)}T00:00:00.000Z`);
        await tx.reviewSchedule.updateMany({
          where: {
            progressId: progress.id,
            OR: [
              { nextReviewOn: { gt: date } },
              { nextReviewOn: null, nextReviewAt: { gt: new Date() } },
            ],
          },
          data: { nextReviewOn: date, nextReviewAt: new Date() },
        });
      }
      return progress;
    });
  }

  async getLevels() {
    const counts = await this.prisma.grammarPoint.groupBy({
      by: ['level'],
      where: { status: ContentStatus.PUBLISHED },
      _count: { _all: true },
    });
    const countMap = new Map(
      counts.map((entry) => [entry.level, entry._count._all]),
    );
    return Object.values(JlptLevel).map((level) => ({
      level,
      grammarCount: countMap.get(level) ?? 0,
      contentStatus: 'AVAILABLE',
    }));
  }

  private withLearningState<
    T extends {
      progress: Array<{
        status: string;
        schedule: Parameters<typeof estimatedRetrievability>[0] | null;
      }>;
    },
  >(item: T, timezone: string) {
    const today = localDateKey(timezone);
    return {
      ...item,
      progress: item.progress.map((progress) => {
        const schedule = progress.schedule;
        const nextReviewOn = schedule?.nextReviewOn
          ? schedule.nextReviewOn.toISOString().slice(0, 10)
          : null;
        return {
          ...progress,
          learningState: {
            status:
              progress.status === 'MASTERED'
                ? 'MASTERED'
                : nextReviewOn && nextReviewOn <= today
                  ? 'DUE'
                  : progress.status,
            stabilityEstimateDays: schedule?.stability ?? null,
            difficultyEstimate: schedule?.difficulty ?? null,
            estimatedRetrievability: schedule
              ? safeRetrievability(schedule)
              : null,
            nextReviewOn,
            algorithmVersion: schedule?.algorithmVersion ?? 'legacy-v1',
            isEstimate: true,
          },
        };
      }),
    };
  }
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
