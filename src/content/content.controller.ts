import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import {
  ContentQueryDto,
  ExpressionQueryDto,
  NoteDto,
  PreviewImportDto,
  SaveExpressionDto,
  ValidateCandidateDto,
} from './content.dto';
import { VocabularyService } from './vocabulary.service';
import { ExpressionsService } from './expressions.service';
import { ContentImportService } from './content-import.service';

@Controller()
@UseGuards(SessionGuard)
export class ContentController {
  constructor(
    private readonly vocabulary: VocabularyService,
    private readonly expressions: ExpressionsService,
    private readonly imports: ContentImportService,
  ) {}
  @Get('vocabulary') async search(
    @Req() req: Request,
    @Query() query: ContentQueryDto,
  ) {
    const result = await this.vocabulary.search(req.currentUser!.id, query);
    return { data: result.items, meta: { nextCursor: result.nextCursor } };
  }
  @Get('vocabulary/bookmarks') async bookmarks(
    @Req() req: Request,
    @Query() query: ContentQueryDto,
  ) {
    const result = await this.vocabulary.bookmarks(req.currentUser!.id, query);
    return { data: result.items, meta: { nextCursor: result.nextCursor } };
  }
  @Get('vocabulary/:id') async vocabularyEntry(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.vocabulary.get(req.currentUser!.id, id) };
  }
  @Put('vocabulary/:id/bookmark') async bookmark(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: NoteDto,
  ) {
    return {
      data: await this.vocabulary.bookmark(req.currentUser!.id, id, dto.note),
    };
  }
  @Delete('vocabulary/:id/bookmark') async removeBookmark(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return {
      data: await this.vocabulary.removeBookmark(req.currentUser!.id, id),
    };
  }
  @Get('expressions') async expressionList(
    @Req() req: Request,
    @Query() query: ExpressionQueryDto,
  ) {
    const result = await this.expressions.list(req.currentUser!.id, query);
    return { data: result.items, meta: { nextCursor: result.nextCursor } };
  }
  @Post('expressions') async saveExpression(
    @Req() req: Request,
    @Body() dto: SaveExpressionDto,
  ) {
    return { data: await this.expressions.save(req.currentUser!.id, dto) };
  }
  @Patch('expressions/:id') async updateExpression(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: NoteDto,
  ) {
    return {
      data: await this.expressions.update(req.currentUser!.id, id, dto.note),
    };
  }
  @Delete('expressions/:id') async removeExpression(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.expressions.remove(req.currentUser!.id, id) };
  }
  @Get('content-imports') async importList(
    @Req() req: Request,
    @Query() query: ContentQueryDto,
  ) {
    const result = await this.imports.list(req.currentUser!.id, query);
    return { data: result.items, meta: { nextCursor: result.nextCursor } };
  }
  @Post('content-imports/preview') async preview(
    @Req() req: Request,
    @Body() dto: PreviewImportDto,
  ) {
    return { data: await this.imports.preview(req.currentUser!.id, dto) };
  }
  @Get('content-imports/:id') async importDetails(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: ContentQueryDto,
  ) {
    return { data: await this.imports.get(req.currentUser!.id, id, query) };
  }
  @Patch('content-candidates/:id/validation') async validate(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() dto: ValidateCandidateDto,
  ) {
    return { data: await this.imports.validate(req.currentUser!.id, id, dto) };
  }
  @Post('content-imports/:id/commit') async commit(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.imports.commit(req.currentUser!.id, id) };
  }
}
