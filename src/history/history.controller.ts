import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { PrismaService } from '../database/prisma.service';
import { initialTimer } from '../study-sessions/study-timer';

@Controller('sentence-attempts')
@UseGuards(SessionGuard)
export class HistoryController {
  constructor(private readonly prisma: PrismaService) {}
  @Get() async list(@Req() request: Request, @Query('cursor') cursor?: string) {
    const items = await this.prisma.sentenceAttempt.findMany({
      where: { userId: request.currentUser!.id },
      include: {
        grammar: { select: { id: true, title: true } },
        aiJob: { include: { result: true } },
      },
      orderBy: { createdAt: 'desc' },
      cursor: cursor ? { id: cursor } : undefined,
      skip: cursor ? 1 : 0,
      take: 31,
    });
    const hasMore = items.length > 30;
    if (hasMore) items.pop();
    return {
      data: items,
      meta: { nextCursor: hasMore ? items.at(-1)?.id : null },
    };
  }
  @Get(':id') async get(@Req() request: Request, @Param('id') id: string) {
    return {
      data: await this.prisma.sentenceAttempt.findFirst({
        where: { id, userId: request.currentUser!.id },
        include: { grammar: true, aiJob: { include: { result: true } } },
      }),
    };
  }
  @Post(':id/practice-again') async practiceAgain(
    @Req() request: Request,
    @Param('id') id: string,
  ) {
    const attempt = await this.prisma.sentenceAttempt.findFirstOrThrow({
      where: { id, userId: request.currentUser!.id },
    });
    const timer = initialTimer();
    return {
      data: await this.prisma.studySession.create({
        data: {
          userId: request.currentUser!.id,
          grammarId: attempt.grammarId,
          mode: 'PRACTICE',
          ...timer,
        },
      }),
    };
  }
}
