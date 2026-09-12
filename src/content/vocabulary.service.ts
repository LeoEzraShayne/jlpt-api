import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { VocabularyLearning } from '@prisma/client';
import type { ContentQueryDto } from './content.dto';

@Injectable()
export class VocabularyService {
  constructor(private readonly prisma: PrismaService) {}
  private visible(userId: string) {
    return {
      validationStatus: 'VALIDATED',
      OR: [{ ownerId: null }, { ownerId: userId }],
    };
  }
  private present<T extends { learning: VocabularyLearning[] }>(entry: T) {
    return { ...entry, learning: entry.learning[0] ?? null };
  }
  async search(userId: string, query: ContentQueryDto) {
    const limit = query.limit ?? 30;
    const items = await this.prisma.vocabularyEntry.findMany({
      where: {
        ...this.visible(userId),
        level: query.level,
        ...(query.query
          ? {
              AND: [
                {
                  OR: [
                    {
                      word: {
                        contains: query.query,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      reading: {
                        contains: query.query,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      chineseGloss: {
                        contains: query.query,
                        mode: 'insensitive' as const,
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { learning: { where: { userId } } },
    });
    const nextCursor = items.length > limit ? items[limit - 1].id : null;
    return {
      items: items.slice(0, limit).map((entry) => this.present(entry)),
      nextCursor,
    };
  }
  async get(userId: string, id: string) {
    const entry = await this.prisma.vocabularyEntry.findFirst({
      where: { id, ...this.visible(userId) },
      include: { learning: { where: { userId } } },
    });
    if (!entry) throw new NotFoundException('Vocabulary entry not found');
    return this.present(entry);
  }
  async bookmark(userId: string, vocabularyId: string, note?: string) {
    await this.get(userId, vocabularyId);
    return this.prisma.vocabularyBookmark.upsert({
      where: { userId_vocabularyId: { userId, vocabularyId } },
      create: { userId, vocabularyId, note },
      update: { ...(note === undefined ? {} : { note }) },
    });
  }
  async bookmarks(userId: string, query: ContentQueryDto) {
    const limit = query.limit ?? 30;
    const rows = await this.prisma.vocabularyBookmark.findMany({
      where: { userId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const entries = await this.prisma.vocabularyEntry.findMany({
      where: {
        id: { in: rows.slice(0, limit).map((row) => row.vocabularyId) },
        ...this.visible(userId),
      },
      include: { learning: { where: { userId } } },
    });
    return {
      items: rows.slice(0, limit).flatMap((row) => {
        const vocabulary = entries.find(
          (entry) => entry.id === row.vocabularyId,
        );
        return vocabulary
          ? [{ ...row, vocabulary: this.present(vocabulary) }]
          : [];
      }),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async removeBookmark(userId: string, vocabularyId: string) {
    await this.prisma.vocabularyBookmark.deleteMany({
      where: { userId, vocabularyId },
    });
    return { deleted: true };
  }
}
