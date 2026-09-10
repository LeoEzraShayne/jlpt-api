import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type {
  CandidateRowDto,
  ContentQueryDto,
  PreviewImportDto,
  ValidateCandidateDto,
} from './content.dto';
import {
  candidateFingerprint,
  candidateProblems,
  fingerprint,
  normalizeContent,
} from './content-fingerprint';

@Injectable()
export class ContentImportService {
  constructor(private readonly prisma: PrismaService) {}
  async preview(userId: string, dto: PreviewImportDto) {
    const unique = new Map(
      dto.rows.map((row) => [candidateFingerprint(row), row]),
    );
    const documentFingerprint = fingerprint([...unique.keys()].sort());
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.contentImport.upsert({
        where: {
          userId_fingerprint: { userId, fingerprint: documentFingerprint },
        },
        create: {
          userId,
          fingerprint: documentFingerprint,
          fileName: dto.fileName,
          sourceName: dto.sourceName,
          sourceVersion: dto.sourceVersion,
          sourceUrl: dto.sourceUrl,
          license: dto.license,
          summary: {
            submitted: dto.rows.length,
            unique: unique.size,
            visibility: 'PRIVATE',
          },
        },
        update: {},
      });
      const result = await tx.contentCandidate.createMany({
        data: [...unique].map(([hash, row]) => ({
          userId,
          importId: batch.id,
          fingerprint: hash,
          kind: row.kind,
          word: normalizeContent(row.word),
          reading: normalizeContent(row.reading),
          senseKey: row.senseKey ?? fingerprint(normalizeContent(row.gloss)),
          payload: {
            ...row,
            sourceName: dto.sourceName,
            sourceVersion: dto.sourceVersion,
            sourceUrl: dto.sourceUrl ?? null,
            location: row.location ?? null,
          },
          validationStatus: 'PENDING',
          validationNotes: candidateProblems(row).join('；'),
        })),
        skipDuplicates: true,
      });
      const inserted = result.count;
      return {
        ...batch,
        inserted,
        duplicates: dto.rows.length - inserted,
        message: '私人候选内容；请核对读音、释义和分级来源后逐条确认。',
      };
    });
  }
  async list(userId: string, query: ContentQueryDto) {
    const limit = query.limit ?? 30;
    const rows = await this.prisma.contentImport.findMany({
      where: { userId, ...(query.cursor ? { id: { gt: query.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return {
      items: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async get(userId: string, id: string, query: ContentQueryDto = {}) {
    const batch = await this.prisma.contentImport.findFirst({
      where: { id, userId },
    });
    if (!batch) throw new NotFoundException('Content import not found');
    const limit = query.limit ?? 50;
    const rows = await this.prisma.contentCandidate.findMany({
      where: {
        userId,
        importId: id,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    return {
      ...batch,
      candidates: rows.slice(0, limit),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async validate(userId: string, id: string, dto: ValidateCandidateDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ContentCandidate" WHERE id = ${id} AND "userId" = ${userId} FOR UPDATE`;
      const candidate = await tx.contentCandidate.findFirst({
        where: { id, userId },
      });
      if (!candidate)
        throw new NotFoundException('Content candidate not found');
      const problems = candidateProblems(
        candidate.payload as unknown as CandidateRowDto,
      );
      if (
        dto.status === 'VALIDATED' &&
        (!dto.checkedAgainstSource || problems.length)
      )
        throw new BadRequestException({
          code: 'CONTENT_REQUIRES_VERIFICATION',
          message: '请核对来源并解决校验问题',
          problems,
        });
      // Revocation removes committed material from future selection too.
      if (candidate.vocabularyId)
        await tx.vocabularyEntry.updateMany({
          where: { id: candidate.vocabularyId, ownerId: userId },
          data: { validationStatus: dto.status },
        });
      return tx.contentCandidate.update({
        where: { id },
        data: {
          validationStatus: dto.status,
          validationNotes: dto.note,
        },
      });
    });
  }
  async commit(userId: string, id: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.contentImport.findFirst({
          where: { id, userId },
        });
        if (!batch) throw new NotFoundException('Content import not found');
        // Serialize validation withdrawal and repeated commits for this owner's rows.
        await tx.$queryRaw`SELECT id FROM "ContentCandidate" WHERE "importId" = ${id} AND "userId" = ${userId} ORDER BY id FOR UPDATE`;
        const rows = await tx.contentCandidate.findMany({
          where: { userId, importId: id, validationStatus: 'VALIDATED' },
        });
        let vocabularyCount = 0;
        for (const candidate of rows) {
          if (candidate.kind !== 'VOCABULARY') continue;
          const row = candidate.payload as unknown as CandidateRowDto;
          const entry = await tx.vocabularyEntry.upsert({
            where: {
              fingerprint: fingerprint([userId, candidate.fingerprint]),
            },
            create: {
              ownerId: userId,
              fingerprint: fingerprint([userId, candidate.fingerprint]),
              word: candidate.word,
              reading: candidate.reading,
              senseKey: candidate.senseKey,
              partOfSpeech: [],
              glosses: [],
              chineseGloss: row.gloss,
              chineseGlossSource: batch.sourceName,
              level: row.level,
              levelSource: row.levelSource,
              sourceName: batch.sourceName,
              sourceVersion: batch.sourceVersion,
              sourceUrl: batch.sourceUrl,
              sourceEntryId: candidate.id,
              license: batch.license,
              validationStatus: 'VALIDATED',
              provenance: {
                importId: id,
                candidateId: candidate.id,
                visibility: 'PRIVATE',
                validationNote: candidate.validationNotes,
                location: row.location ?? null,
              },
            },
            update: { validationStatus: 'VALIDATED' },
          });
          await tx.contentCandidate.update({
            where: { id: candidate.id },
            data: { vocabularyId: entry.id },
          });
          vocabularyCount += 1;
        }
        await tx.contentImport.update({
          where: { id },
          data: { status: 'COMMITTED' },
        });
        return {
          id,
          status: 'COMMITTED',
          vocabularyCount,
          phraseCount: rows.filter((row) => row.kind === 'PHRASE').length,
          visibility: 'PRIVATE',
        };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }
}
