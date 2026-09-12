import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { localDateKey } from '../review/adaptive-review';
import { lockLearning, requireVocabulary } from './vocabulary-learning.db';
import {
  dueLearning,
  manualChange,
  OPEN_STATUSES,
  presentLearning,
  visibleVocabulary,
} from './vocabulary-learning.policy';
import type { LearningQueryDto, ManualAction } from './vocabulary-learning.dto';
import {
  practiceInclude,
  presentPractice,
} from './vocabulary-practice.presenter';

/** Actual UTC instants bracketing a local calendar day, including 23/25-hour DST days. */
export function localDayBounds(timezone: string, now: Date) {
  const today = localDateKey(timezone, now);
  const boundary = (after: boolean) => {
    let low = now.getTime() - 36 * 3_600_000;
    let high = now.getTime() + 36 * 3_600_000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const key = localDateKey(timezone, new Date(mid));
      if (after ? key > today : key >= today) high = mid;
      else low = mid + 1;
    }
    return new Date(low);
  };
  return { gte: boundary(false), lt: boundary(true) };
}

@Injectable()
export class VocabularyLearningService {
  constructor(private readonly prisma: PrismaService) {}

  async setLearning(
    userId: string,
    vocabularyId: string,
    action: ManualAction,
  ) {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      await requireVocabulary(tx, userId, vocabularyId);
      // Upsert is serialized by the unique owner/sense key, including first marking.
      if (['UNKNOWN', 'PRACTICE', 'REMEMBERED'].includes(action)) {
        // Serialize first-time upserts too: Prisma may implement an empty-update
        // upsert as read/create, before a learning row exists to lock.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${vocabularyId}`}, 0))`;
        await tx.vocabularyLearning.upsert({
          where: { userId_vocabularyId: { userId, vocabularyId } },
          create: { userId, vocabularyId, nextReviewAt: now },
          update: {},
        });
      }
      const learning = await lockLearning(tx, userId, vocabularyId);
      const change = manualChange(learning, action, now);
      if (!change) return presentLearning(learning);
      const saved = await tx.vocabularyLearning.update({
        where: { id: learning.id },
        data: change,
      });
      // Preserve the immutable answer/history but free the unique unfinished slot.
      // The lease predicate prevents any outstanding AI response from reviving it.
      await tx.vocabularyPractice.updateMany({
        where: { learningId: learning.id, status: { in: OPEN_STATUSES } },
        data: {
          status: 'FAILED',
          lockedAt: null,
          errorCode: 'LEARNING_CHANGED',
        },
      });
      return presentLearning(saved);
    });
  }

  /** Integration helper for existing search/bookmark endpoints; never creates learning rows. */
  async learningByVocabularyIds(userId: string, vocabularyIds: string[]) {
    const rows = await this.prisma.vocabularyLearning.findMany({
      where: {
        userId,
        vocabularyId: { in: vocabularyIds },
        vocabulary: visibleVocabulary(userId),
      },
    });
    return new Map(rows.map((row) => [row.vocabularyId, presentLearning(row)]));
  }

  async list(userId: string, query: LearningQueryDto) {
    const limit = query.limit ?? 30;
    const filter: Prisma.VocabularyLearningWhereInput =
      query.list === 'DUE'
        ? dueLearning()
        : query.list === 'PRACTICE'
          ? { practiceEnabled: true }
          : query.list === 'REMEMBERED'
            ? { knowledge: 'REMEMBERED' }
            : query.list === 'UNKNOWN'
              ? { knowledge: 'UNKNOWN' }
              : {};
    const rows = await this.prisma.vocabularyLearning.findMany({
      where: {
        userId,
        ...filter,
        ...(query.cursor ? { vocabularyId: { gt: query.cursor } } : {}),
        vocabulary: {
          ...visibleVocabulary(userId),
          level: query.level,
          ...(query.query
            ? {
                AND: [
                  {
                    OR: ['word', 'reading', 'chineseGloss'].map((field) => ({
                      [field]: { contains: query.query, mode: 'insensitive' },
                    })),
                  },
                ],
              }
            : {}),
        },
      },
      include: { vocabulary: true },
      orderBy: { vocabularyId: 'asc' },
      take: limit + 1,
    });
    return {
      data: rows.slice(0, limit).map(({ vocabulary, ...learning }) => ({
        ...vocabulary,
        learning: presentLearning(learning),
      })),
      meta: {
        nextCursor: rows.length > limit ? rows[limit - 1].vocabularyId : null,
      },
    };
  }

  async summary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const now = new Date();
    const where = { userId, vocabulary: visibleVocabulary(userId) };
    const [
      unknownCount,
      practiceCount,
      rememberedCount,
      dueCount,
      completedTodayCount,
    ] = await this.prisma.$transaction([
      this.prisma.vocabularyLearning.count({
        where: { ...where, knowledge: 'UNKNOWN' },
      }),
      this.prisma.vocabularyLearning.count({
        where: { ...where, practiceEnabled: true },
      }),
      this.prisma.vocabularyLearning.count({
        where: { ...where, knowledge: 'REMEMBERED' },
      }),
      this.prisma.vocabularyLearning.count({
        where: { ...where, ...dueLearning(now) },
      }),
      this.prisma.vocabularyPractice.count({
        where: {
          ...where,
          status: 'COMPLETED',
          completedAt: localDayBounds(user.timezone, now),
        },
      }),
    ]);
    return {
      unknownCount,
      practiceCount,
      rememberedCount,
      dueCount,
      completedTodayCount,
    };
  }

  async history(userId: string, vocabularyId: string, query: LearningQueryDto) {
    await requireVocabulary(this.prisma, userId, vocabularyId);
    const limit = query.limit ?? 20;
    const rows = await this.prisma.vocabularyPractice.findMany({
      where: {
        userId,
        vocabularyId,
        status: 'COMPLETED',
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: practiceInclude,
    });
    return {
      data: rows.slice(0, limit).map(presentPractice),
      meta: { nextCursor: rows.length > limit ? rows[limit - 1].id : null },
    };
  }
}
