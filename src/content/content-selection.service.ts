import { Injectable, NotFoundException } from '@nestjs/common';
import type { JlptLevel } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { fingerprint } from './content-fingerprint';

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
    const seed = Number.parseInt(
      fingerprint([
        userId,
        grammarId,
        sessionId ?? new Date().toISOString().slice(0, 10),
      ]).slice(0, 8),
      16,
    );
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
    const bookmarkIds = bookmarks
      .map((row) => row.vocabularyId)
      .filter((id) => !recentIds.has(id));
    const rotation = bookmarkIds.length ? seed % bookmarkIds.length : 0;
    const preferredIds = [
      ...bookmarkIds.slice(rotation),
      ...bookmarkIds.slice(0, rotation),
    ].slice(0, 2);
    const preferred = await this.prisma.vocabularyEntry.findMany({
      where: {
        ...visible,
        id: { in: preferredIds },
        level: { in: allowedLevels },
      },
      take: 2,
      orderBy: { id: 'asc' },
    });
    const where = {
      ...visible,
      level: { in: allowedLevels },
      id: { notIn: [...recentIds, ...preferred.map((row) => row.id)] },
    };
    let count = await this.prisma.vocabularyEntry.count({ where });
    // Recycle after all available words have been encountered; there is no new queue.
    if (!count) {
      where.id.notIn = preferred.map((row) => row.id);
      count = await this.prisma.vocabularyEntry.count({ where });
    }
    const remaining = 2 - preferred.length;
    const words =
      remaining > 0 && count > 0
        ? preferred.concat(
            await this.prisma.vocabularyEntry.findMany({
              where,
              orderBy: { id: 'asc' },
              skip: seed % Math.max(1, count - remaining + 1),
              take: remaining,
            }),
          )
        : preferred;
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
    return { expressions, words, phrases };
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
