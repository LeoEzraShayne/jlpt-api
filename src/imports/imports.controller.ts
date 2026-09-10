import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { SessionGuard } from '../auth/session.guard';
import { ImportGrammarDto } from './dto/import-grammar.dto';
import { ImportsService } from './imports.service';

@Controller('admin/imports')
@UseGuards(SessionGuard, AdminGuard)
@Throttle({ default: { limit: 5, ttl: 600_000 } })
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}
  @Post('grammar/dry-run') async dryRun(
    @Body() dto: ImportGrammarDto,
    @Req() request: Request,
  ) {
    return { data: await this.imports.dryRun(dto, request.currentUser!.id) };
  }
  @Post('grammar/commit') async commit(
    @Body() dto: ImportGrammarDto,
    @Req() request: Request,
  ) {
    return { data: await this.imports.commit(dto, request.currentUser!.id) };
  }
  @Get(':batchId') async getBatch(@Param('batchId') id: string) {
    return { data: await this.imports.getBatch(id) };
  }
}
