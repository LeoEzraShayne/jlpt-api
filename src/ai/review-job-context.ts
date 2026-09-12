import { Prisma } from '@prisma/client';
import { readTrainingContext } from '../scenes/training-context';
import type { ReviewProviderInput } from './ai-provider';
export const reviewJobInclude = {
  attempt: {
    include: {
      studySession: true,
      grammar: {
        include: {
          examples: { take: 1, orderBy: { sortOrder: 'asc' as const } },
        },
      },
    },
  },
};
export type ReviewJob = Prisma.AiReviewJobGetPayload<{
  include: typeof reviewJobInclude;
}>;
export function jobInput(job: ReviewJob): ReviewProviderInput {
  return {
    explanationLocale:
      job.attempt.studySession.explanationLocale === 'en' ? 'en' : 'zh',
    usageContext: {
      userId: job.attempt.userId,
      taskKind: 'GRAMMAR',
      taskKey: job.attempt.studySessionId,
      attempt: job.retryCount * 2 + 1,
    },
    grammarLevel: job.attempt.grammar.level,
    grammarTitle: job.attempt.grammar.title,
    explanation: job.attempt.grammar.chineseExplanation,
    connectionRule: job.attempt.grammar.connectionRule,
    exampleSentence: job.attempt.grammar.examples[0]?.sentence,
    sentence: job.attempt.sentence,
    scene: job.attempt.scene,
    trainingMode: job.attempt.studySession.trainingMode,
    trainingContext: readTrainingContext(
      job.attempt.studySession.trainingContext,
    ),
  };
}
