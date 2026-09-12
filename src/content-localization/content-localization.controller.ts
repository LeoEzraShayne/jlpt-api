import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../database/prisma.service';
import {
  contentLocale,
  ContentLocalizationService,
} from './content-localization.service';
import { scenarioSource } from './content-source';
export class LocaleQueryDto {
  @IsOptional() @IsIn(['zh', 'en']) locale?: 'zh' | 'en';
}
@Controller()
@UseGuards(SessionGuard)
export class ContentLocalizationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localization: ContentLocalizationService,
  ) {}
  @Get('training-scenarios')
  async scenarios(@Req() req: Request, @Query() query: LocaleQueryDto) {
    const rows = await this.prisma.trainingScenario.findMany({
      where: { active: true },
      orderBy: { id: 'asc' },
    });
    const translated = await this.localization.resolveMany(
      rows.map(scenarioSource),
      contentLocale(query.locale ?? req.currentUser!.explanationLocale),
    );
    return {
      data: rows.map((s) => ({
        ...s,
        localized: translated.get(`SCENARIO:${s.id}`),
      })),
    };
  }
}
