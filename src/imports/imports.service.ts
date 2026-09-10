import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ImportStatus, JlptLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { ImportGrammarDto } from './dto/import-grammar.dto';
import { parseGrammarText, ParsedGrammar } from './grammar-parser';

const DATASET = 'N1-N5语法总结-v1';

@Injectable()
export class ImportsService {
  constructor(private readonly prisma: PrismaService) {}

  async dryRun(dto: ImportGrammarDto, operatorId?: string) {
    const parsed = parseGrammarText(dto.content);
    const batch = await this.prisma.importBatch.create({
      data: {
        dataset: DATASET,
        fileName: dto.fileName,
        fileHash: parsed.fileHash,
        status: parsed.issues.length
          ? ImportStatus.FAILED
          : ImportStatus.VALIDATED,
        summary: {
          counts: parsed.counts,
          total: parsed.grammars.length,
          relationGroups: parsed.relations.length,
        },
        operatorId,
        errors: {
          create: parsed.issues.map((issue) => ({
            line: issue.line,
            code: issue.code,
            message: issue.message,
          })),
        },
      },
      include: { errors: true },
    });
    return { batch, preview: parsed.grammars.slice(0, 5) };
  }

  async commit(dto: ImportGrammarDto, operatorId?: string) {
    const parsed = parseGrammarText(dto.content);
    if (parsed.issues.length)
      throw new BadRequestException({
        code: 'IMPORT_VALIDATION_FAILED',
        message: 'Grammar import failed validation',
        details: parsed.issues,
      });
    return this.prisma.$transaction(
      async (tx) => {
        const batch = await tx.importBatch.create({
          data: {
            dataset: DATASET,
            fileName: dto.fileName,
            fileHash: parsed.fileHash,
            status: ImportStatus.COMMITTED,
            summary: {
              counts: parsed.counts,
              total: parsed.grammars.length,
              relationGroups: parsed.relations.length,
            },
            operatorId,
            committedAt: new Date(),
          },
        });
        const imported: Array<{ id: string; title: string; level: JlptLevel }> =
          [];
        for (const grammar of parsed.grammars)
          imported.push(await this.upsertGrammar(tx, grammar));
        await tx.grammarRelationGroup.deleteMany({
          where: { level: JlptLevel.N1, type: 'CONFUSABLE' },
        });
        for (const group of parsed.relations) {
          const memberIds = this.resolveMembers(
            group.memberHints,
            imported.filter((item) => item.level === group.level),
          );
          await tx.grammarRelationGroup.create({
            data: {
              level: group.level,
              type: 'CONFUSABLE',
              title: group.title,
              notes: group.notes,
              sortOrder: group.ordinal,
              members: {
                create: memberIds.map((grammarId) => ({ grammarId })),
              },
            },
          });
        }
        return batch;
      },
      { timeout: 30_000 },
    );
  }

  async getBatch(id: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id },
      include: { errors: true },
    });
    if (!batch)
      throw new NotFoundException({
        code: 'IMPORT_NOT_FOUND',
        message: 'Import batch not found',
      });
    return batch;
  }

  private async upsertGrammar(
    tx: Prisma.TransactionClient,
    grammar: ParsedGrammar,
  ) {
    const item = await tx.grammarPoint.upsert({
      where: {
        sourceDataset_level_sourceOrdinal: {
          sourceDataset: DATASET,
          level: grammar.level,
          sourceOrdinal: grammar.ordinal,
        },
      },
      create: {
        level: grammar.level,
        title: grammar.title,
        chineseExplanation: grammar.explanation,
        connectionRule: grammar.connectionRule,
        sortOrder: grammar.ordinal,
        status: 'PUBLISHED',
        sourceDataset: DATASET,
        sourceOrdinal: grammar.ordinal,
        sourceHash: grammar.sourceHash,
      },
      update: {
        title: grammar.title,
        chineseExplanation: grammar.explanation,
        connectionRule: grammar.connectionRule,
        sortOrder: grammar.ordinal,
        sourceHash: grammar.sourceHash,
      },
    });
    await tx.grammarExample.upsert({
      where: { grammarId_sortOrder: { grammarId: item.id, sortOrder: 1 } },
      create: {
        grammarId: item.id,
        sentence: grammar.example,
        translation: grammar.translation,
      },
      update: { sentence: grammar.example, translation: grammar.translation },
    });
    return { id: item.id, title: item.title, level: item.level };
  }

  private resolveMembers(
    hints: string[],
    grammars: Array<{ id: string; title: string }>,
  ) {
    const normalize = (value: string) =>
      value.replace(/[・（）()\s]/g, '').replace(/[～〜]/g, '～');
    const ids = new Set<string>();
    for (const hint of hints) {
      const key = normalize(hint);
      const match = grammars.find(
        (grammar) =>
          normalize(grammar.title).includes(key) ||
          key.includes(normalize(grammar.title)),
      );
      if (match) ids.add(match.id);
    }
    return [...ids];
  }
}
