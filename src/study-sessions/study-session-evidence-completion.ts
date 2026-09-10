import { Prisma, ProgressStatus, type StudySession } from '@prisma/client';
import { CompleteStudySessionDto } from './dto/study-session.dto';
import {
  ADAPTIVE_ALGORITHM_VERSION,
  localDateKey,
} from '../review/adaptive-review';
import { calculateEvidenceReview } from '../review/evidence-scheduling';
import {
  isDueReview,
  MASTERY_RULE_VERSION,
  qualifiesForMastery,
  resolveEvidenceRating,
  resolveEvidenceStatus,
  validateScenarioEvidence,
  type MasteryEvidence,
} from './review-evidence';
import { withReviewOutcome } from './study-session-outcome';
import { finishEvidenceSession } from './study-session-finish';

/** Caller holds user, session and progress-key locks, in that order. */
export async function completeEvidenceReview(
  tx: Prisma.TransactionClient,
  session: StudySession,
  timezone: string,
  dto: CompleteStudySessionDto,
) {
  const now = new Date();
  const today = localDateKey(timezone, now);
  const progress = await tx.userGrammarProgress.upsert({
    where: {
      userId_grammarId: {
        userId: session.userId,
        grammarId: session.grammarId,
      },
    },
    create: { userId: session.userId, grammarId: session.grammarId },
    update: {},
    include: { schedule: true },
  });
  const firstAttempt = await tx.sentenceAttempt.findFirst({
    where: { studySessionId: session.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { aiJob: { include: { result: true } } },
  });
  const ai = firstAttempt?.aiJob?.result;
  const resolution = resolveEvidenceRating(
    dto.recallRating,
    ai ?? undefined,
    session.hintRevealCount,
  );
  const recentDueEvents = await tx.reviewEvent.findMany({
    where: {
      progressId: progress.id,
      OR: [
        { dueReview: true },
        {
          evidenceVersion: { not: MASTERY_RULE_VERSION },
          affectsSchedule: true,
        },
      ],
    },
    orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
    take: 2,
  });
  const scheduledOn =
    progress.schedule?.nextReviewOn?.toISOString().slice(0, 10) ??
    (progress.schedule
      ? localDateKey(timezone, progress.schedule.nextReviewAt)
      : null);
  const initial = progress.status === ProgressStatus.NOT_STARTED;
  const dueReview =
    !initial &&
    isDueReview({
      mode: session.mode,
      today,
      sessionStartedOn: localDateKey(timezone, session.createdAt),
      scheduledOn,
      previousDueDate:
        recentDueEvents[0]?.reviewDate?.toISOString().slice(0, 10) ?? null,
    });
  const scheduling = calculateEvidenceReview({
    schedule: progress.schedule,
    rating: resolution.effectiveRating,
    hasScore: resolution.hasScore,
    dueReview,
    initial,
    now,
    timezone,
  });
  // Only server-persisted scenes from prior successful submissions can establish transfer.
  const priorScenes = await tx.reviewEvent.findMany({
    where: {
      progressId: progress.id,
      evidenceVersion: MASTERY_RULE_VERSION,
      scenarioTaskCompleted: true,
      targetGrammarCorrect: true,
      firstScore: { gte: 80 },
      hintRevealCount: 0,
      reviewedAt: { lt: session.createdAt },
    },
    orderBy: { reviewedAt: 'desc' },
    take: 30,
    include: {
      session: { select: { scenarioId: true, trainingContext: true } },
    },
  });
  const scene = validateScenarioEvidence({
    scenarioId: session.scenarioId,
    trainingMode: session.trainingMode,
    trainingContext: session.trainingContext,
    taskCompleted: ai?.scenarioTaskCompleted,
    previous: priorScenes.map((event) => event.session),
  });
  const evidence: MasteryEvidence = {
    evidenceVersion: MASTERY_RULE_VERSION,
    firstAttemptId: firstAttempt?.id ?? null,
    firstScore: resolution.hasScore ? ai!.totalScore : null,
    targetGrammarCorrect: resolution.confirmedTarget
      ? true
      : ai?.usedTargetGrammar === false || ai?.targetGrammarCorrect === false
        ? false
        : null,
    dueReview,
    reviewDate: new Date(`${today}T00:00:00.000Z`),
    submittedRating: dto.recallRating,
    effectiveRating: resolution.effectiveRating,
    hintRevealCount: session.hintRevealCount,
    ...scene,
  };
  evidence.crossScenarioValid =
    evidence.crossScenarioValid && qualifiesForMastery(evidence);
  const status = resolveEvidenceStatus({
    previousStatus: progress.status,
    current: evidence,
    recentDueEvents,
    stability: scheduling.stabilityAfter,
    assessed: resolution.hasScore || session.hintRevealCount > 0,
  });
  const { outcome } = scheduling;
  if (scheduling.affectsSchedule) {
    const fsrsData = scheduling.applyFsrs
      ? {
          lastReviewAt: now,
          stability: outcome.stabilityAfter,
          difficulty: outcome.difficultyAfter,
          fsrsState: outcome.fsrsState,
          elapsedDays: outcome.elapsedDays,
          reps: outcome.reps,
          lapses: outcome.lapses,
          stateSource: outcome.stateSource,
        }
      : {};
    const data = {
      nextReviewAt: scheduling.nextReviewOn,
      nextReviewOn: scheduling.nextReviewOn,
      scheduledDays: scheduling.intervalDays,
      algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
      ...fsrsData,
    };
    await tx.reviewSchedule.upsert({
      where: { progressId: progress.id },
      create: { progressId: progress.id, ...data },
      update: data,
    });
  }
  const meaningful = scheduling.applyFsrs || evidence.dueReview;
  await tx.userGrammarProgress.update({
    where: { id: progress.id },
    data: {
      status:
        initial &&
        status === ProgressStatus.NOT_STARTED &&
        (resolution.hasScore || session.mode === 'LEARN')
          ? ProgressStatus.LEARNING
          : status,
      masteryRuleVersion:
        status !== ProgressStatus.MASTERED ||
        (dueReview && qualifiesForMastery(evidence))
          ? MASTERY_RULE_VERSION
          : undefined,
      needsWork:
        status === ProgressStatus.NEEDS_WORK
          ? true
          : resolution.hasScore && status !== ProgressStatus.NOT_STARTED
            ? false
            : undefined,
      reviewCount: meaningful ? { increment: 1 } : undefined,
      correctStreak: dueReview
        ? qualifiesForMastery(evidence)
          ? { increment: 1 }
          : 0
        : undefined,
      lastScore: evidence.firstScore ?? undefined,
      lastStudiedAt: now,
    },
  });
  const reviewEvent = await tx.reviewEvent.create({
    data: {
      ...evidence,
      userId: session.userId,
      grammarId: session.grammarId,
      progressId: progress.id,
      sessionId: session.id,
      taskId: session.taskId,
      profileId: outcome.profileId,
      reviewedAt: now,
      scheduledFor: scheduledOn
        ? new Date(`${scheduledOn}T00:00:00.000Z`)
        : null,
      nextReviewOn: scheduling.nextReviewOn,
      elapsedDays: outcome.elapsedDays,
      aiScore: evidence.firstScore,
      aiEvidence: resolution.aiEvidence,
      scenarioId: session.scenarioId,
      affectsSchedule: scheduling.affectsSchedule,
      retrievabilityBefore: outcome.retrievabilityBefore,
      stabilityBefore: outcome.stabilityBefore,
      stabilityAfter: scheduling.stabilityAfter,
      difficultyBefore: outcome.difficultyBefore,
      difficultyAfter: scheduling.difficultyAfter,
      scheduledDaysAfter: scheduling.intervalDays,
      algorithmVersion: scheduling.affectsSchedule
        ? ADAPTIVE_ALGORITHM_VERSION
        : 'practice-only-v2',
    },
  });
  const completed = await finishEvidenceSession(
    tx,
    session,
    timezone,
    now,
    !!ai,
  );
  return withReviewOutcome(completed, reviewEvent);
}
