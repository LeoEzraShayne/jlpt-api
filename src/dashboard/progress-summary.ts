import { ProgressStatus } from '@prisma/client';

type ProgressCount = {
  status: ProgressStatus;
  _count: { _all: number };
};

export function buildProgressSummary(
  totalGrammar: number,
  progressCounts: ProgressCount[],
) {
  const countFor = (status: ProgressStatus) =>
    progressCounts.find((item) => item.status === status)?._count._all ?? 0;
  const masteredGrammar = Math.min(
    totalGrammar,
    countFor(ProgressStatus.MASTERED),
  );
  const needsWorkGrammar = Math.min(
    totalGrammar - masteredGrammar,
    countFor(ProgressStatus.NEEDS_WORK),
  );
  const learningGrammar = Math.min(
    totalGrammar - masteredGrammar - needsWorkGrammar,
    countFor(ProgressStatus.LEARNING) + countFor(ProgressStatus.DUE),
  );
  const notStartedGrammar = Math.max(
    0,
    totalGrammar - masteredGrammar - needsWorkGrammar - learningGrammar,
  );
  const learnedGrammar = masteredGrammar + needsWorkGrammar + learningGrammar;

  return {
    masteryPercent:
      totalGrammar > 0 ? Math.round((masteredGrammar / totalGrammar) * 100) : 0,
    masteredGrammar,
    learningGrammar,
    needsWorkGrammar,
    notStartedGrammar,
    unmasteredGrammar: Math.max(0, totalGrammar - masteredGrammar),
    learnedGrammar,
    trackedGrammar: learnedGrammar,
  };
}
