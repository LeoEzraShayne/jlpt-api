import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SessionMode, TaskStatus, TaskType } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { localDate } from '../dashboard/dashboard.service';
import { CreateStudySessionDto } from './dto/study-session.dto';
import { initialTimer, presentTimer, resolveTimer } from './study-timer';
import { lockStudyUser } from './study-session-ledger';
export async function createStudySession(
  prisma: PrismaService,
  userId: string,
  timezone: string,
  dto: CreateStudySessionDto,
) {
  return prisma.$transaction(async (tx) => {
    await lockStudyUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { targetLevel: true },
    });
    const { value: today } = localDate(timezone);
    const grammar = await tx.grammarPoint.findUnique({
      where: { id: dto.grammarId },
      include: { examples: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!grammar)
      throw new NotFoundException({
        code: 'GRAMMAR_NOT_FOUND',
        message: 'Grammar point not found',
      });
    let taskId = dto.taskId;
    if (!taskId && dto.mode === SessionMode.REVIEW) {
      const { value: taskDate } = localDate(timezone);
      const todayReview = await tx.studyTask.findFirst({
        where: {
          userId,
          grammarId: dto.grammarId,
          taskDate: { lte: taskDate },
          type: TaskType.REVIEW,
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
        },
        orderBy: [{ taskDate: 'asc' }, { createdAt: 'asc' }],
      });
      taskId = todayReview?.id;
    }
    if (taskId) {
      const task = await tx.studyTask.findUnique({
        where: { id: taskId },
      });
      if (!task || task.userId !== userId || task.grammarId !== dto.grammarId)
        throw new BadRequestException({
          code: 'INVALID_TASK',
          message: 'Task does not match session',
        });
      if (
        task.status !== TaskStatus.PENDING &&
        task.status !== TaskStatus.IN_PROGRESS
      )
        throw new BadRequestException({
          code: 'TASK_NOT_OPEN',
          message: 'Task is no longer open',
        });
      if (task.taskDate > today || task.type !== dto.mode)
        throw new BadRequestException({
          code: 'INVALID_TASK_MODE',
          message: 'Task date or mode does not match session',
        });
      const existing = await tx.studySession.findUnique({
        where: { taskId },
      });
      if (existing)
        return {
          session: { ...existing, timer: presentTimer(resolveTimer(existing)) },
          grammar,
        };
      if (task.type === TaskType.LEARN) {
        const remainingReviews = await tx.studyTask.count({
          where: {
            userId,
            taskDate: today,
            type: TaskType.REVIEW,
            status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
            plan: { status: 'ACTIVE', startDate: { lte: today } },
            grammar: {
              level:
                grammar.level === user.targetLevel
                  ? user.targetLevel
                  : { not: user.targetLevel },
            },
          },
        });
        if (remainingReviews > 0)
          throw new ConflictException({
            code: 'REVIEW_REQUIRED',
            message: '请先完成今天安排的复习任务',
            remainingReviews,
          });
      }
    }
    const timer = initialTimer();
    const session = await tx.studySession.create({
      data: {
        userId,
        grammarId: dto.grammarId,
        taskId,
        mode: dto.mode,
        revealedAt:
          dto.mode === SessionMode.LEARN
            ? timer.timerPhaseStartedAt
            : undefined,
        lastActivityAt: timer.timerPhaseStartedAt,
        ...timer,
      },
    });
    if (taskId)
      await tx.studyTask.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS' },
      });
    return {
      session: { ...session, timer: presentTimer(resolveTimer(session)) },
      grammar,
    };
  });
}
