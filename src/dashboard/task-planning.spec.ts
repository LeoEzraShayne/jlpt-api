import {
  calculateNewGrammarCount,
  NEEDS_WORK_REVIEW_MINUTES,
  NEW_GRAMMAR_MINUTES,
  REVIEW_MINUTES,
  selectReviews,
} from './task-planning';

const candidate = (
  grammarId: string,
  overrides: Partial<{
    nextReviewAt: Date;
    status: string;
    masteryScore: number;
    lastScore: number | null;
  }> = {},
) => ({
  grammarId,
  nextReviewAt: new Date('2026-08-01T00:00:00.000Z'),
  status: 'DUE',
  masteryScore: 50,
  lastScore: 80,
  ...overrides,
});

describe('daily task planning', () => {
  it('uses 4 minutes for normal reviews and 6 for needs-work reviews', () => {
    expect(selectReviews([candidate('normal')], 20).selectedMinutes).toBe(
      REVIEW_MINUTES,
    );
    expect(
      selectReviews([candidate('weak', { status: 'NEEDS_WORK' })], 20)
        .selectedMinutes,
    ).toBe(NEEDS_WORK_REVIEW_MINUTES);
  });

  it('always selects at least one due review even when the budget is five minutes', () => {
    const result = selectReviews(
      [candidate('weak', { status: 'NEEDS_WORK' })],
      5,
    );
    expect(result.selected.map((item) => item.grammarId)).toEqual(['weak']);
  });

  it('prioritizes older overdue items before weakness and mastery', () => {
    const result = selectReviews(
      [
        candidate('newer-weak', {
          nextReviewAt: new Date('2026-08-02T00:00:00.000Z'),
          status: 'NEEDS_WORK',
        }),
        candidate('older', {
          nextReviewAt: new Date('2026-07-20T00:00:00.000Z'),
        }),
      ],
      10,
    );
    expect(result.selected[0].grammarId).toBe('older');
  });

  it('prioritizes needs-work within the same due day before exact due time', () => {
    const result = selectReviews(
      [
        candidate('normal-earlier', {
          nextReviewAt: new Date('2026-08-02T01:00:00.000Z'),
        }),
        candidate('weak-later', {
          nextReviewAt: new Date('2026-08-02T20:00:00.000Z'),
          status: 'NEEDS_WORK',
        }),
      ],
      20,
    );
    expect(result.selected[0].grammarId).toBe('weak-later');
  });

  it('does not force another review after a preserved review fills the budget', () => {
    const result = selectReviews([candidate('extra')], 5, REVIEW_MINUTES);
    expect(result.selected).toEqual([]);
    expect(result.selectedMinutes).toBe(REVIEW_MINUTES);
  });

  it('uses the full daily budget instead of a fixed review percentage', () => {
    const result = selectReviews(
      [
        candidate('high-priority-weak', { status: 'NEEDS_WORK' }),
        candidate('lower-priority-normal', {
          nextReviewAt: new Date('2026-08-01T01:00:00.000Z'),
        }),
      ],
      20,
      REVIEW_MINUTES,
    );
    expect(result.selected.map((item) => item.grammarId)).toEqual([
      'high-priority-weak',
      'lower-priority-normal',
    ]);
  });

  it('does not treat a missing AI score as lower than a known low score', () => {
    const result = selectReviews(
      [
        candidate('unknown', { lastScore: null }),
        candidate('known-low', { lastScore: 70 }),
      ],
      20,
    );
    expect(result.selected[0].grammarId).toBe('known-low');
  });

  it('fits new grammar into remaining time and respects the configured limit', () => {
    expect(
      calculateNewGrammarCount({
        dailyMinutes: 20,
        dailyNewLimit: 10,
        usedMinutes: 4,
        hasDueReviews: true,
      }),
    ).toBe(2);
    expect(NEW_GRAMMAR_MINUTES).toBe(8);
  });

  it('still schedules one new grammar when there are no reviews and time is short', () => {
    expect(
      calculateNewGrammarCount({
        dailyMinutes: 5,
        dailyNewLimit: 10,
        usedMinutes: 0,
        hasDueReviews: false,
      }),
    ).toBe(1);
  });
});
