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
import { SessionGuard } from '../auth/session.guard';
import {
  CompleteStudySessionDto,
  CreateStudySessionDto,
} from './dto/study-session.dto';
import { StudySessionsService } from './study-sessions.service';

@Controller('study-sessions')
@UseGuards(SessionGuard)
export class StudySessionsController {
  constructor(private readonly sessions: StudySessionsService) {}
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) {
    return { data: await this.sessions.get(request.currentUser!.id, id) };
  }
  @Post() async create(
    @Req() request: Request,
    @Body() dto: CreateStudySessionDto,
  ) {
    return {
      data: await this.sessions.create(
        request.currentUser!.id,
        request.currentUser!.timezone,
        dto,
      ),
    };
  }
  @Post(':id/reveal') async reveal(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return { data: await this.sessions.reveal(request.currentUser!.id, id) };
  }
  @Post(':id/timer/advance') async advanceTimer(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return {
      data: await this.sessions.advanceTimer(request.currentUser!.id, id),
    };
  }
  @Post(':id/activity') async recordActivity(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    return {
      data: await this.sessions.recordActivity(request.currentUser!.id, id),
    };
  }
  @Post(':id/complete') async complete(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() dto: CompleteStudySessionDto,
  ) {
    return {
      data: await this.sessions.complete(
        request.currentUser!.id,
        request.currentUser!.timezone,
        id,
        dto,
      ),
    };
  }
}
