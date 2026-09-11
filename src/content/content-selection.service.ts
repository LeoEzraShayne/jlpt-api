import { Injectable, NotFoundException } from '@nestjs/common';
import type { JlptLevel, VocabularyEntry } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import type { PracticeTask } from '../scenes/grammar-practice-catalog';
import { practiceMeaning, PRACTICE_GLOSS_SOURCE } from './practice-vocabulary';

@Injectable()
export class ContentSelectionService {
  constructor(private readonly prisma: PrismaService) {}
  // Server-only selection. The session service must hide expression text during
  // formal review and use its existing reveal/hint mechanism before returning it.
  async selectForPractice(
    userId: string,
    grammarId: string,
    level: JlptLevel,
    sessionId?: string,
    task?: PracticeTask,
  ) {
    const [expressions, bookmarks, imports] = await Promise.all([
      this.prisma.personalExpression.findMany({
        where: { userId, grammarId },
        orderBy: { updatedAt: 'desc' },
        take: 3,
      }),
      this.prisma.vocabularyBookmark.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      this.prisma.contentImport.findMany({
        where: { userId, status: 'COMMITTED' },
        select: { id: true },
      }),
    ]);
    const levels: JlptLevel[] = ['N1', 'N2', 'N3', 'N4'];
    const allowedLevels = levels.slice(levels.indexOf(level));
    const visible = {
      validationStatus: 'VALIDATED',
      OR: [{ ownerId: null }, { ownerId: userId }],
    };
    const recent = await this.prisma.contentExposure.findMany({
      where: {
        userId,
        contentType: 'VOCABULARY',
        ...(sessionId ? { sessionId: { not: sessionId } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { contentId: true },
    });
    const recentIds = new Set(recent.map((row) => row.contentId));
    const bookmarkIds = new Set(bookmarks.map((row) => row.vocabularyId));
    const candidates = task?.words.length
      ? await this.prisma.vocabularyEntry.findMany({
          where: {
            ...visible,
            level: { in: allowedLevels },
            word: { in: task.words },
          },
          orderBy: { id: 'asc' },
        })
      : [];
    // Personal priority only ranks already relevant words; it never widens the pool.
    const ranked = candidates
      .flatMap((entry) => {
        const meaning = practiceMeaning(entry);
        return meaning
          ? [
              {
                ...entry,
                chineseGloss: meaning.chineseGloss,
                chineseGlossSource: PRACTICE_GLOSS_SOURCE,
              },
            ]
          : [];
      })
      .sort(
        (a, b) =>
          Number(recentIds.has(a.id)) - Number(recentIds.has(b.id)) ||
          Number(bookmarkIds.has(b.id)) - Number(bookmarkIds.has(a.id)) ||
          task!.words.indexOf(a.word) - task!.words.indexOf(b.word),
      );
    const words: VocabularyEntry[] = [];
    for (const entry of ranked) {
      if (
        !words.some(
          (row) => row.word === entry.word && row.reading === entry.reading,
        )
      )
        words.push(entry);
      if (words.length === 2) break;
    }
    const phrases = await this.prisma.contentCandidate.findMany({
      where: {
        userId,
        importId: { in: imports.map((row) => row.id) },
        kind: 'PHRASE',
        validationStatus: 'VALIDATED',
      },
      orderBy: { updatedAt: 'desc' },
      take: 3,
    });
    return {
      expressions,
      words,
      phrases: phrases.filter((phrase) =>
        task?.words.some((word) => phrase.word.includes(word)),
      ),
    };
  }
  // Never changes review events, grades, or grammar mastery.
  async recordExposure(
    userId: string,
    sessionId: string,
    contentType: 'VOCABULARY' | 'EXPRESSION' | 'GRAMMAR' | 'PHRASE',
    contentId: string,
    interaction: 'EXPOSED' | 'USED',
  ) {
    const session = await this.prisma.studySession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException('Study session not found');
    const accessible =
      contentType === 'VOCABULARY'
        ? await this.prisma.vocabularyEntry.findFirst({
            where: {
              id: contentId,
              validationStatus: 'VALIDATED',
              OR: [{ ownerId: null }, { ownerId: userId }],
            },
          })
        : contentType === 'EXPRESSION'
          ? await this.prisma.personalExpression.findFirst({
              where: { id: contentId, userId },
            })
          : contentType === 'PHRASE'
            ? await this.prisma.contentCandidate.findFirst({
                where: {
                  id: contentId,
                  userId,
                  kind: 'PHRASE',
                  validationStatus: 'VALIDATED',
                },
              })
            : await this.prisma.grammarPoint.findFirst({
                where: { id: contentId, status: 'PUBLISHED' },
              });
    if (!accessible) throw new NotFoundException('Content not found');
    return this.prisma.contentExposure.upsert({
      where: {
        userId_sessionId_contentType_contentId_interaction: {
          userId,
          sessionId,
          contentType,
          contentId,
          interaction,
        },
      },
      create: { userId, sessionId, contentType, contentId, interaction },
      update: {},
    });
  }
}
