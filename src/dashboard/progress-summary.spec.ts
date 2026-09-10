import { ProgressStatus } from '@prisma/client';
import { buildProgressSummary } from './progress-summary';

const count = (status: ProgressStatus, value: number) => ({
  status,
  _count: { _all: value },
});

describe('buildProgressSummary', () => {
  it('returns zeroes without grammar or progress', () => {
    expect(buildProgressSummary(0, [])).toEqual({
      masteryPercent: 0,
      masteredGrammar: 0,
      learningGrammar: 0,
      needsWorkGrammar: 0,
      notStartedGrammar: 0,
      unmasteredGrammar: 0,
      learnedGrammar: 0,
      trackedGrammar: 0,
    });
  });

  it('separates learned grammar from mastered grammar', () => {
    expect(
      buildProgressSummary(4, [
        count(ProgressStatus.MASTERED, 1),
        count(ProgressStatus.LEARNING, 1),
        count(ProgressStatus.NOT_STARTED, 1),
      ]),
    ).toEqual({
      masteryPercent: 25,
      masteredGrammar: 1,
      learningGrammar: 1,
      needsWorkGrammar: 0,
      notStartedGrammar: 2,
      unmasteredGrammar: 3,
      learnedGrammar: 2,
      trackedGrammar: 2,
    });
  });

  it('rounds nine mastered grammar points out of forty to 23 percent', () => {
    expect(
      buildProgressSummary(40, [
        count(ProgressStatus.MASTERED, 9),
        count(ProgressStatus.LEARNING, 1),
      ]),
    ).toEqual({
      masteryPercent: 23,
      masteredGrammar: 9,
      learningGrammar: 1,
      needsWorkGrammar: 0,
      notStartedGrammar: 30,
      unmasteredGrammar: 31,
      learnedGrammar: 10,
      trackedGrammar: 10,
    });
  });

  it('returns four mutually exclusive progress buckets', () => {
    const summary = buildProgressSummary(10, [
      count(ProgressStatus.MASTERED, 1),
      count(ProgressStatus.LEARNING, 2),
      count(ProgressStatus.DUE, 1),
      count(ProgressStatus.NEEDS_WORK, 2),
      count(ProgressStatus.NOT_STARTED, 1),
    ]);

    expect(summary).toMatchObject({
      masteredGrammar: 1,
      learningGrammar: 3,
      needsWorkGrammar: 2,
      notStartedGrammar: 4,
    });
    expect(
      summary.masteredGrammar +
        summary.learningGrammar +
        summary.needsWorkGrammar +
        summary.notStartedGrammar,
    ).toBe(10);
  });

  it('returns one hundred percent when every grammar point is mastered', () => {
    expect(
      buildProgressSummary(2, [count(ProgressStatus.MASTERED, 2)]),
    ).toEqual({
      masteryPercent: 100,
      masteredGrammar: 2,
      learningGrammar: 0,
      needsWorkGrammar: 0,
      notStartedGrammar: 0,
      unmasteredGrammar: 0,
      learnedGrammar: 2,
      trackedGrammar: 2,
    });
  });

  it('caps inconsistent progress counts at the published grammar total', () => {
    expect(
      buildProgressSummary(2, [
        count(ProgressStatus.MASTERED, 3),
        count(ProgressStatus.LEARNING, 1),
      ]),
    ).toEqual({
      masteryPercent: 100,
      masteredGrammar: 2,
      learningGrammar: 0,
      needsWorkGrammar: 0,
      notStartedGrammar: 0,
      unmasteredGrammar: 0,
      learnedGrammar: 2,
      trackedGrammar: 2,
    });
  });
});
