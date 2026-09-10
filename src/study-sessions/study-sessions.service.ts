import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProgressStatus,
  SessionMode,
  SessionStatus,
  TaskStatus,
  TaskType,
} from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { localDate } from '../dashboard/dashboard.service';
import { calculateReview } from '../review/review-algorithm';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  addCalendarDays,
  algorithmModeForUser,
  calculateAdaptiveReview,
  calendarDayDifference,
  localDateKey,
  resolveRating,
  type ReviewAlgorithmMode,
} from '../review/adaptive-review';
import {
  CompleteStudySessionDto,
  CreateStudySessionDto,
} from './dto/study-session.dto';
import {
  initialTimer,
  PersistedTimer,
  presentTimer,
  resolveTimer,
} from './study-timer';
import {
  accountableActivitySeconds,
  withReviewOutcome,
} from './study-session-outcome';
import { recordStudyActivity } from './study-session-activity';
import { revealStudyHint } from './study-session-hints';
import { resolveProgressStatus } from './review-mastery';

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
    const grammar = await this.prisma.grammarPoint.findUnique({
      where: { id: dto.grammarId },
      include: { examples: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!grammar)
      throw new NotFoundException({
        code: 'GRAMMAR_NOT_FOUND',
        message: 'Grammar point not found',
      });
    let taskId = dto.taskId;
    if (
      !taskId &&
      (dto.mode === SessionMode.REVIEW || dto.mode === SessionMode.PRACTICE)
    ) {
      const { value: taskDate } = localDate(timezone);
      const todayReview = await this.prisma.studyTask.findFirst({
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
      const task = await this.prisma.studyTask.findUnique({
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
      const existing = await this.prisma.studySession.findUnique({
        where: { taskId },
      });
      if (existing) return { session: this.withTimer(existing), grammar };
      if (task.type === TaskType.LEARN) {
        const remainingReviews = await this.prisma.studyTask.count({
          where: {
            userId,
            taskDate: task.taskDate,
            type: TaskType.REVIEW,
            status: { not: TaskStatus.COMPLETED },
            grammar: { level: grammar.level },
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
    const session = await this.prisma.studySession.create({
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
      await this.prisma.studyTask.update({
        where: { id: taskId },
        data: { status: 'IN_PROGRESS' },
      });
    return { session: this.withTimer(session), grammar };
  }
  async reveal(userId: string, id: string) {
    return this.withTimer(await revealStudyHint(this.prisma, userId, id));
  }
  async advanceTimer(userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
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
    const selectedJob = dto.sentenceReviewId
      ? await this.prisma.aiReviewJob.findUnique({
          where: { id: dto.sentenceReviewId },
          include: { result: true, attempt: true },
        })
      : null;
    if (
      dto.sentenceReviewId &&
      (!selectedJob?.result || selectedJob.attempt.studySessionId !== id)
    )
      throw new BadRequestException({
        code: 'REVIEW_NOT_READY',
        message: 'Sentence review is not completed for this session',
      });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "StudySession" WHERE id = ${id} FOR UPDATE`,
      );
      const owned = await tx.studySession.findUnique({ where: { id } });
      if (!owned || owned.userId !== userId)
        throw new NotFoundException({
          code: 'SESSION_NOT_FOUND',
          message: 'Study session not found',
        });
      if (owned.status === SessionStatus.COMPLETED) {
        const event = await tx.reviewEvent.findUnique({
          where: { sessionId: id },
        });
        return withReviewOutcome(owned, event);
      }
      const progress = await tx.userGrammarProgress.upsert({
        where: { userId_grammarId: { userId, grammarId: owned.grammarId } },
        create: { userId, grammarId: owned.grammarId },
        update: {},
        include: { schedule: true },
      });
      const firstAttempt = await tx.sentenceAttempt.findFirst({
        where: {
          studySessionId: id,
          aiJob: { result: { isNot: null } },
        },
        include: { aiJob: { include: { result: true } } },
        orderBy: { createdAt: 'asc' },
      });
      const aiResult = firstAttempt?.aiJob?.result;
      const resolution = resolveRating(
        dto.recallRating,
        aiResult
          ? {
              totalScore: aiResult.totalScore,
              usedTargetGrammar: aiResult.usedTargetGrammar,
              targetGrammarCorrect: aiResult.targetGrammarCorrect,
            }
          : undefined,
      );
      const now = new Date();
      const legacyOutcome = calculateReview({
        stage: progress.stage,
        masteryScore: progress.masteryScore,
        rating: resolution.effectiveRating,
        isInitial: progress.status === ProgressStatus.NOT_STARTED,
        now,
      });
      const adaptiveOutcome = calculateAdaptiveReview({
        schedule: progress.schedule,
        rating: resolution.effectiveRating,
        now,
        timezone,
      });
      const recentEvent = await tx.reviewEvent.findFirst({
        where: {
          progressId: progress.id,
          affectsSchedule: true,
        },
        orderBy: { reviewedAt: 'desc' },
      });
      const affectsSchedule =
        owned.mode !== SessionMode.PRACTICE ||
        Boolean(owned.taskId) ||
        !recentEvent ||
        localDateKey(timezone, recentEvent.reviewedAt) !==
          localDateKey(timezone, now);
      const configuredMode =
        this.config?.get<ReviewAlgorithmMode>('REVIEW_ALGORITHM_MODE') ??
        'legacy';
      const rolloutPercent =
        this.config?.get<number>('REVIEW_ALGORITHM_ROLLOUT_PERCENT') ?? 0;
      const mode = algorithmModeForUser(configuredMode, rolloutPercent, userId);
      const legacyNextKey = localDateKey(timezone, legacyOutcome.nextReviewAt);
      const appliedAdaptive = mode === 'adaptive';
      const appliedNextKey = appliedAdaptive
        ? adaptiveOutcome.nextReviewOn.toISOString().slice(0, 10)
        : legacyNextKey;
      const appliedInterval = calendarDayDifference(
        localDateKey(timezone, now),
        appliedNextKey,
      );
      const existingNextKey = progress.schedule?.nextReviewOn
        ? progress.schedule.nextReviewOn.toISOString().slice(0, 10)
        : progress.schedule
          ? localDateKey(timezone, progress.schedule.nextReviewAt)
          : addCalendarDays(localDateKey(timezone, now), 1);
      const nextReviewKey = affectsSchedule ? appliedNextKey : existingNextKey;
      const recentRatings = await tx.reviewEvent.findMany({
        where: { progressId: progress.id, affectsSchedule: true },
        select: { effectiveRating: true, hintRevealCount: true },
        orderBy: { reviewedAt: 'desc' },
        take: 2,
      });
      const status = resolveProgressStatus({
        affectsSchedule,
        reps: adaptiveOutcome.reps,
        stabilityAfter: adaptiveOutcome.stabilityAfter,
        effectiveRating: resolution.effectiveRating,
        sessionMode: owned.mode,
        hintRevealCount: owned.hintRevealCount,
        recentEvents: recentRatings,
      });
      if (affectsSchedule)
        await tx.reviewSchedule.upsert({
          where: { progressId: progress.id },
          create: {
            progressId: progress.id,
            nextReviewAt: new Date(`${nextReviewKey}T00:00:00.000Z`),
            nextReviewOn: new Date(`${nextReviewKey}T00:00:00.000Z`),
            lastReviewAt: now,
            algorithmVersion: appliedAdaptive
              ? ADAPTIVE_ALGORITHM_VERSION
              : 'legacy-v1',
            stability: adaptiveOutcome.stabilityAfter,
            difficulty: adaptiveOutcome.difficultyAfter,
            fsrsState: adaptiveOutcome.fsrsState,
            scheduledDays: appliedInterval,
            elapsedDays: adaptiveOutcome.elapsedDays,
            reps: adaptiveOutcome.reps,
            lapses: adaptiveOutcome.lapses,
            stateSource: adaptiveOutcome.stateSource,
          },
          update: {
            nextReviewAt: new Date(`${nextReviewKey}T00:00:00.000Z`),
            nextReviewOn: new Date(`${nextReviewKey}T00:00:00.000Z`),
            lastReviewAt: now,
            algorithmVersion: appliedAdaptive
              ? ADAPTIVE_ALGORITHM_VERSION
              : 'legacy-v1',
            stability: adaptiveOutcome.stabilityAfter,
            difficulty: adaptiveOutcome.difficultyAfter,
            fsrsState: adaptiveOutcome.fsrsState,
            scheduledDays: appliedInterval,
            elapsedDays: adaptiveOutcome.elapsedDays,
            reps: adaptiveOutcome.reps,
            lapses: adaptiveOutcome.lapses,
            stateSource: adaptiveOutcome.stateSource,
          },
        });
      await tx.userGrammarProgress.update({
        where: { id: progress.id },
        data: {
          stage: affectsSchedule ? legacyOutcome.stage : undefined,
          masteryScore: affectsSchedule
            ? legacyOutcome.masteryScore
            : undefined,
          status: affectsSchedule ? status : undefined,
          reviewCount: affectsSchedule ? { increment: 1 } : undefined,
          correctStreak: affectsSchedule
            ? legacyOutcome.correct
              ? { increment: 1 }
              : 0
            : undefined,
          lastScore: aiResult?.totalScore,
          lastStudiedAt: now,
        },
      });
      const scheduledFor =
        progress.schedule?.nextReviewOn ??
        (owned.taskId
          ? (await tx.studyTask.findUnique({ where: { id: owned.taskId } }))
              ?.taskDate
          : null);
      const reviewEvent = await tx.reviewEvent.create({
        data: {
          userId,
          grammarId: owned.grammarId,
          progressId: progress.id,
          sessionId: id,
          taskId: owned.taskId,
          profileId: adaptiveOutcome.profileId,
          reviewedAt: now,
          scheduledFor,
          nextReviewOn: new Date(`${nextReviewKey}T00:00:00.000Z`),
          elapsedDays: adaptiveOutcome.elapsedDays,
          submittedRating: dto.recallRating,
          effectiveRating: resolution.effectiveRating,
          aiScore: aiResult?.totalScore,
          aiEvidence: resolution.aiEvidence,
          hintRevealCount:
            owned.mode === SessionMode.REVIEW ? owned.hintRevealCount : 0,
          affectsSchedule,
          retrievabilityBefore: adaptiveOutcome.retrievabilityBefore,
          stabilityBefore: adaptiveOutcome.stabilityBefore,
          stabilityAfter: adaptiveOutcome.stabilityAfter,
          difficultyBefore: adaptiveOutcome.difficultyBefore,
          difficultyAfter: adaptiveOutcome.difficultyAfter,
          scheduledDaysAfter: affectsSchedule
            ? appliedInterval
            : (progress.schedule?.scheduledDays ?? 1),
          algorithmVersion: affectsSchedule
            ? appliedAdaptive
              ? ADAPTIVE_ALGORITHM_VERSION
              : 'legacy-v1'
            : 'practice-only-v1',
          legacyOutcome: {
            ...legacyOutcome,
            nextReviewAt: legacyOutcome.nextReviewAt.toISOString(),
          },
          shadowOutcome: appliedAdaptive
            ? undefined
            : {
                ...adaptiveOutcome,
                nextReviewAt: adaptiveOutcome.nextReviewAt.toISOString(),
                nextReviewOn: adaptiveOutcome.nextReviewOn.toISOString(),
              },
        },
      });
      const creditedSeconds = accountableActivitySeconds(owned, now);
      const activeSeconds = owned.activeSeconds + creditedSeconds;
      const session = await tx.studySession.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          activeSeconds,
          lastActivityAt: now,
        },
      });
      if (owned.taskId)
        await tx.studyTask.update({
          where: { id: owned.taskId },
          data: { status: 'COMPLETED', completedAt: now },
        });
      const { value: studyDate } = localDate(timezone);
      await tx.dailyStudyStat.upsert({
        where: { userId_studyDate: { userId, studyDate } },
        create: {
          userId,
          studyDate,
          tasksCompleted: owned.taskId ? 1 : 0,
          sentenceCount: aiResult ? 1 : 0,
          studyMinutes: Math.ceil(activeSeconds / 60),
        },
        update: {
          tasksCompleted: owned.taskId ? { increment: 1 } : undefined,
          sentenceCount: aiResult ? { increment: 1 } : undefined,
          studyMinutes: activeSeconds
            ? { increment: Math.ceil(activeSeconds / 60) }
            : undefined,
        },
      });
      return withReviewOutcome(session, reviewEvent);
    });
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
