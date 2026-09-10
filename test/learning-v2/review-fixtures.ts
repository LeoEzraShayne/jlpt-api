import type { Harness } from './harness';
import { localDateKey } from '../../src/review/adaptive-review';
import type { StudySession } from '@prisma/client';

export async function reviewedAttempt(
  h: Harness,
  session: StudySession,
  score: number | null,
  correct = true,
  completedScene = true,
) {
  const attempt = await h.prisma.sentenceAttempt.create({
    data: {
      userId: session.userId,
      grammarId: session.grammarId,
      studySessionId: session.id,
      source: 'REVIEW',
      sentence: 'おんがくをききながらあるく。',
      createdAt: new Date(),
    },
  });
  if (score === null) return { attempt, job: null };
  const job = await h.prisma.aiReviewJob.create({
    data: { attemptId: attempt.id, status: 'COMPLETED' },
  });
  await h.prisma.aiReviewResult.create({
    data: {
      jobId: job.id,
      provider: 'GEMINI',
      model: 'synthetic-no-network',
      promptVersion: 'f-fixture',
      totalScore: score,
      grammarScore: 30,
      connectionScore: 20,
      completenessScore: 20,
      naturalnessScore: 10,
      vocabularyScore: 0,
      isCorrect: correct,
      usedTargetGrammar: true,
      targetGrammarCorrect: correct,
      scenarioTaskCompleted: completedScene,
      resultLevel: 'CORRECT',
      errorSpans: [],
      correctedSentence: attempt.sentence,
      explanationZh: '固定案例',
      encouragement: '固定案例',
      latencyMs: 0,
    },
  });
  return { attempt, job };
}
export async function existingProgress(
  h: Harness,
  userId: string,
  days = 0,
  status: 'LEARNING' | 'MASTERED' = 'LEARNING',
) {
  const due = new Date(`${localDateKey('Asia/Tokyo')}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + days);
  return h.prisma.userGrammarProgress.create({
    data: {
      userId,
      grammarId: 'f-N1-0',
      status,
      masteryRuleVersion: 'mastery-v2',
      reviewCount: 4,
      schedule: {
        create: {
          nextReviewAt: due,
          nextReviewOn: due,
          stability: 60,
          difficulty: 5,
          fsrsState: 'REVIEW',
          reps: 4,
          lastReviewAt: new Date(Date.now() - 60 * 86400000),
          scheduledDays: 60,
          algorithmVersion: 'adaptive-v1',
        },
      },
    },
    include: { schedule: true },
  });
}
export async function reviewSession(
  h: Harness,
  userId: string,
  scene = 'home',
  objective = scene,
  mode: 'REVIEW' | 'PRACTICE' | 'LEARN' = 'REVIEW',
) {
  return h.prisma.studySession.create({
    data: {
      userId,
      grammarId: 'f-N1-0',
      mode,
      createdAt: new Date(),
      timerPhaseEndsAt: new Date(Date.now() + 1500000),
      scenarioId: scene,
      trainingMode: 'TRANSFER',
      trainingContext: {
        scenario: {
          version: 'scenario-v1',
          scenarioId: scene,
          taskId: `task-${scene}`,
          objectiveId: objective,
          register: 'POLITE',
        },
      },
    },
  });
}
export function freezeDate(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'nextTick',
      'queueMicrotask',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
      'performance',
      'hrtime',
    ],
  });
}
