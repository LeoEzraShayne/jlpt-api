import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProgressStatus,
  SessionMode,
  SessionStatus,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
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
import { CompleteStudySessionDto } from './dto/study-session.dto';
import { withReviewOutcome } from './study-session-outcome';
import { resolveProgressStatus } from './review-mastery';
import { finishEvidenceSession } from './study-session-finish';
import { lockStudyUser, lockStudySession } from './study-session-ledger';
import { completeEvidenceReview } from './study-session-evidence-completion';
export async function completeStudySession(
  prisma: PrismaService,
  config: ConfigService | undefined,
  userId: string,
  timezone: string,
  id: string,
  dto: CompleteStudySessionDto,
) {
  return prisma.$transaction(async (tx) => {
    await lockStudyUser(tx, userId);
    await lockStudySession(tx, id);
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
    if (owned.status !== SessionStatus.ACTIVE)
      throw new BadRequestException({
        code: 'SESSION_NOT_ACTIVE',
        message: 'Only active sessions can complete',
      });
    const selectedJob = dto.sentenceReviewId
      ? await tx.aiReviewJob.findUnique({
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

    // Serializes different sessions for the same grammar, including first creation.
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${owned.grammarId}`}, 0))`,
    );
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { learningV2Enabled: true },
    });
    if (user.learningV2Enabled)
      return completeEvidenceReview(tx, owned, timezone, dto);
    const progress = await tx.userGrammarProgress.upsert({
      where: { userId_grammarId: { userId, grammarId: owned.grammarId } },
      create: { userId, grammarId: owned.grammarId },
      update: {},
      include: { schedule: true },
    });
    const firstAttempt = await tx.sentenceAttempt.findFirst({
      where: {
        studySessionId: id,
      },
      include: { aiJob: { include: { result: true } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
      config?.get<ReviewAlgorithmMode>('REVIEW_ALGORITHM_MODE') ?? 'legacy';
    const rolloutPercent =
      config?.get<number>('REVIEW_ALGORITHM_ROLLOUT_PERCENT') ?? 0;
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
        masteryScore: affectsSchedule ? legacyOutcome.masteryScore : undefined,
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
    const session = await finishEvidenceSession(
      tx,
      owned,
      timezone,
      now,
      !!aiResult,
    );
    return withReviewOutcome(session, reviewEvent);
  });
}
