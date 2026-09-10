import { ProgressStatus, RecallRating, SessionMode } from '@prisma/client';
import { resolveProgressStatus } from './review-mastery';

const hintFreeRemembered = {
  effectiveRating: RecallRating.REMEMBERED,
  hintRevealCount: 0,
};

function evidence(
  overrides: Partial<Parameters<typeof resolveProgressStatus>[0]> = {},
) {
  return {
    affectsSchedule: true,
    reps: 5,
    stabilityAfter: 30,
    effectiveRating: RecallRating.REMEMBERED,
    sessionMode: SessionMode.REVIEW,
    hintRevealCount: 0,
    recentEvents: [hintFreeRemembered, hintFreeRemembered],
    ...overrides,
  };
}

describe('review mastery evidence', () => {
  it('confirms mastery after three remembered reviews without hints', () => {
    expect(resolveProgressStatus(evidence())).toBe(ProgressStatus.MASTERED);
  });

  it('does not confirm mastery when the current review opened a hint', () => {
    expect(resolveProgressStatus(evidence({ hintRevealCount: 1 }))).toBe(
      ProgressStatus.LEARNING,
    );
  });

  it('does not confirm mastery when a recent review opened a hint', () => {
    expect(
      resolveProgressStatus(
        evidence({
          recentEvents: [
            { ...hintFreeRemembered, hintRevealCount: 2 },
            hintFreeRemembered,
          ],
        }),
      ),
    ).toBe(ProgressStatus.LEARNING);
  });

  it('keeps forgotten reviews in needs-work state', () => {
    expect(
      resolveProgressStatus(evidence({ effectiveRating: RecallRating.FORGOT })),
    ).toBe(ProgressStatus.NEEDS_WORK);
  });

  it('does not penalize the automatically shown first-learning hint', () => {
    expect(
      resolveProgressStatus(
        evidence({ sessionMode: SessionMode.LEARN, hintRevealCount: 1 }),
      ),
    ).toBe(ProgressStatus.MASTERED);
  });
});
