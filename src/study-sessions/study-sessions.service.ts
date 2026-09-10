import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import {
  CompleteStudySessionDto,
  CreateStudySessionDto,
} from './dto/study-session.dto';
import { PersistedTimer, presentTimer, resolveTimer } from './study-timer';
import { recordStudyActivity } from './study-session-activity';
import { revealStudyHint } from './study-session-hints';
import { createStudySession } from './study-session-create';
import { lockStudySession, lockStudyUser } from './study-session-ledger';
import { completeStudySession } from './study-session-completion';

@Injectable()
export class StudySessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config?: ConfigService,
  ) {}
  async get(userId: string, id: string) {
    const session = await this.prisma.studySession.findFirst({
      where: { id, userId },
      include: {
        grammar: {
          include: {
            examples: { orderBy: { sortOrder: 'asc' } },
            relationMembers: {
              include: {
                group: {
                  include: {
                    members: {
                      include: {
                        grammar: { select: { id: true, title: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        attempts: {
          orderBy: { createdAt: 'desc' },
          include: { aiJob: { include: { result: true } } },
        },
      },
    });
    if (!session)
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Study session not found',
      });
    return this.withTimer(session);
  }
  async create(userId: string, timezone: string, dto: CreateStudySessionDto) {
    return createStudySession(this.prisma, userId, timezone, dto);
  }
  async reveal(userId: string, id: string) {
    return this.withTimer(await revealStudyHint(this.prisma, userId, id));
  }
  async advanceTimer(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockStudyUser(tx, userId);
      await lockStudySession(tx, id);
      const session = await tx.studySession.findUnique({ where: { id } });
      if (!session || session.userId !== userId)
        throw new NotFoundException({
          code: 'SESSION_NOT_FOUND',
          message: 'Study session not found',
        });
      if (session.status !== SessionStatus.ACTIVE)
        throw new BadRequestException({
          code: 'SESSION_NOT_ACTIVE',
          message: 'Only an active study session can advance its timer',
        });
      const resolved = resolveTimer(session);
      const unchanged =
        resolved.timerPhase === session.timerPhase &&
        resolved.timerPhaseStartedAt.getTime() ===
          session.timerPhaseStartedAt.getTime() &&
        resolved.timerPhaseEndsAt.getTime() ===
          session.timerPhaseEndsAt.getTime();
      if (unchanged) return presentTimer(resolved);
      const updated = await tx.studySession.update({
        where: { id },
        data: resolved,
      });
      return presentTimer(updated);
    });
  }
  async complete(
    userId: string,
    timezone: string,
    id: string,
    dto: CompleteStudySessionDto,
  ) {
    return completeStudySession(
      this.prisma,
      this.config,
      userId,
      timezone,
      id,
      dto,
    );
  }
  async recordActivity(userId: string, id: string) {
    return recordStudyActivity(this.prisma, userId, id);
  }
  private withTimer<T extends PersistedTimer>(session: T) {
    return {
      ...session,
      timer: presentTimer(resolveTimer(session)),
    };
  }
}
