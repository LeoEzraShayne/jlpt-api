import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import {
  LearningActionDto,
  LearningQueryDto,
  StartVocabularyPracticeDto,
  VocabularyAnswerDto,
} from './vocabulary-learning.dto';
import { VocabularyLearningService } from './vocabulary-learning.service';
import { VocabularyPracticeService } from './vocabulary-practice.service';

@Controller()
@UseGuards(SessionGuard)
export class VocabularyLearningController {
  constructor(
    private readonly learning: VocabularyLearningService,
    private readonly practices: VocabularyPracticeService,
  ) {}

  @Patch('vocabulary/:id/learning') async setLearning(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: LearningActionDto,
  ) {
    return {
      data: await this.learning.setLearning(
        req.currentUser!.id,
        id,
        body.action,
      ),
    };
  }
  @Get('vocabulary-learning') list(
    @Req() req: Request,
    @Query() query: LearningQueryDto,
  ) {
    return this.learning.list(req.currentUser!.id, query);
  }
  @Get('vocabulary-learning/summary') async summary(@Req() req: Request) {
    return { data: await this.learning.summary(req.currentUser!.id) };
  }
  @Get('vocabulary/:id/learning-history') history(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: LearningQueryDto,
  ) {
    return this.learning.history(req.currentUser!.id, id, query);
  }
  @Post('vocabulary-practices') async start(
    @Req() req: Request,
    @Body() body: StartVocabularyPracticeDto,
  ) {
    return { data: await this.practices.start(req.currentUser!.id, body) };
  }
  @Get('vocabulary-practices/:id') async practice(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.practices.get(req.currentUser!.id, id) };
  }
  @Post('vocabulary-practices/:id/hint') async hint(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.practices.hint(req.currentUser!.id, id) };
  }
  @Post('vocabulary-practices/:id/answer') async answer(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: VocabularyAnswerDto,
  ) {
    return { data: await this.practices.answer(req.currentUser!.id, id, body) };
  }
  @Post('vocabulary-practices/:id/retry') async retry(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.practices.retry(req.currentUser!.id, id) };
  }
}
