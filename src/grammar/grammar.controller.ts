import {
  Body,
  Controller,
  Get,
  Put,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ContentStatus, JlptLevel } from '@prisma/client';
import { GrammarService } from './grammar.service';
import { SessionGuard } from '../auth/session.guard';

class GrammarQueryDto {
  @IsOptional() @IsIn(['zh', 'en']) locale?: 'zh' | 'en';
  @IsOptional() @IsEnum(JlptLevel) level?: JlptLevel;
  @IsOptional() @IsEnum(ContentStatus) status?: ContentStatus;
  @IsOptional() @IsString() query?: string;
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class NeedsWorkDto {
  @IsBoolean() needsWork!: boolean;
}

@Controller()
@UseGuards(SessionGuard)
export class GrammarController {
  constructor(private readonly grammar: GrammarService) {}

  @Get('grammar-points')
  async findAll(@Req() request: Request, @Query() query: GrammarQueryDto) {
    const result = await this.grammar.findAll(
      {
        ...query,
        locale:
          query.locale ??
          (request.currentUser!.explanationLocale === 'en' ? 'en' : 'zh'),
      },
      request.currentUser!.id,
      request.currentUser!.timezone,
    );
    return { data: result.items, meta: { nextCursor: result.nextCursor } };
  }

  @Get('grammar-points/:id')
  async findOne(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: GrammarQueryDto,
  ) {
    return {
      data: await this.grammar.findOne(
        id,
        request.currentUser!.id,
        request.currentUser!.timezone,
        query.locale ??
          (request.currentUser!.explanationLocale === 'en' ? 'en' : 'zh'),
      ),
    };
  }

  @Put('grammar-points/:id/needs-work')
  async markNeedsWork(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: NeedsWorkDto,
  ) {
    return {
      data: await this.grammar.markNeedsWork(
        id,
        request.currentUser!.id,
        dto.needsWork,
      ),
    };
  }

  @Get('grammar-levels')
  async getLevels() {
    return { data: await this.grammar.getLevels() };
  }
}
