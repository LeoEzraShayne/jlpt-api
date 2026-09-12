import type { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import {
  exampleSource,
  grammarSource,
  relationSource,
  type ContentSource,
  type TextFields,
} from './content-source';
import { grammarDisplayTitle } from './grammar-title';
import { validateTranslation } from './translation-validation';

export interface LocalizedContent {
  requestedLocale: 'zh' | 'en';
  resolvedLocale: 'zh' | 'en' | null;
  status: 'ORIGINAL' | 'VALIDATED' | 'MISSING' | 'STALE';
  sourceHash: string;
  fields: TextFields | null;
}
export function contentLocale(value?: string): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh';
}
@Injectable()
export class ContentLocalizationService {
  constructor(private readonly prisma: PrismaService) {}
  async resolveMany(
    sources: ContentSource[],
    locale: 'zh' | 'en',
    db: Pick<Prisma.TransactionClient, 'contentTranslation'> = this.prisma,
  ) {
    const result = new Map<string, LocalizedContent>();
    const rows =
      locale === 'en' && sources.length
        ? await db.contentTranslation.findMany({
            where: {
              locale,
              status: 'VALIDATED',
              OR: sources.map(({ entityType, entityId }) => ({
                entityType,
                entityId,
              })),
            },
          })
        : [];
    for (const item of sources) {
      const matching = rows.filter(
        (r) => r.entityType === item.entityType && r.entityId === item.entityId,
      );
      const exact = matching.find((r) => r.sourceHash === item.sourceHash);
      const fields = exact?.fields as TextFields | undefined;
      const valid = fields && validateTranslation(item, fields).length === 0;
      result.set(`${item.entityType}:${item.entityId}`, {
        requestedLocale: locale,
        resolvedLocale: locale === 'zh' ? 'zh' : valid ? 'en' : null,
        status:
          locale === 'zh'
            ? 'ORIGINAL'
            : valid
              ? 'VALIDATED'
              : matching.length
                ? 'STALE'
                : 'MISSING',
        sourceHash: item.sourceHash,
        fields: locale === 'zh' ? item.fields : valid ? fields : null,
      });
    }
    return result;
  }
  async grammar<
    T extends Parameters<typeof grammarSource>[0] & {
      examples?: Parameters<typeof exampleSource>[0][];
      relationMembers?: { group: Parameters<typeof relationSource>[0] }[];
    },
  >(items: T[], locale: 'zh' | 'en') {
    const sources = items.flatMap((g) => [
      grammarSource(g),
      ...(g.examples ?? []).map(exampleSource),
      ...(g.relationMembers ?? []).map((r) => relationSource(r.group)),
    ]);
    const translations = await this.resolveMany(sources, locale);
    return items.map((g) => ({
      ...g,
      displayTitle: grammarDisplayTitle(g.title, locale),
      localized: translations.get(`GRAMMAR:${g.id}`)!,
      ...(g.examples
        ? {
            examples: g.examples.map((e) => ({
              ...e,
              localized: translations.get(`EXAMPLE:${e.id}`)!,
            })),
          }
        : {}),
      ...(g.relationMembers
        ? {
            relationMembers: g.relationMembers.map((r) => ({
              ...r,
              group: {
                ...r.group,
                localized: translations.get(`RELATION:${r.group.id}`)!,
              },
            })),
          }
        : {}),
    }));
  }
}
