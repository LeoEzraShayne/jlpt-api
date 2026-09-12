import {
  manualChange,
  isEnabled,
  presentLearning,
} from './vocabulary-learning.policy';
import { restoreCard, scheduleWord, wordOutcome } from './vocabulary-evidence';
import { localDayBounds } from './vocabulary-learning.service';
import {
  assessment,
  makeLearning,
  makePractice,
  now,
} from './vocabulary-test-fixtures';

describe('manual vocabulary authority', () => {
  it('UNKNOWN preserves memory/history and resets enabled practice', () => {
    const row = makeLearning({ memoryCard: { stability: 10 } });
    expect(manualChange(row, 'UNKNOWN', now)).toEqual({
      knowledge: 'UNKNOWN',
      practiceEnabled: false,
      paused: false,
      nextReviewAt: now,
      manualRevision: { increment: 1 },
    });
    expect(row.memoryCard).toEqual({ stability: 10 });
  });
  it('PRACTICE makes an unknown word known and due', () => {
    expect(
      manualChange(
        makeLearning({
          knowledge: 'UNKNOWN',
          practiceEnabled: false,
          nextReviewAt: null,
        }),
        'PRACTICE',
        now,
      ),
    ).toMatchObject({
      knowledge: 'KNOWN',
      practiceEnabled: true,
      nextReviewAt: now,
    });
  });
  it('REMEMBERED preserves production practice and cancels meaning-only due', () => {
    expect(manualChange(makeLearning(), 'REMEMBERED', now)).toMatchObject({
      knowledge: 'REMEMBERED',
      practiceEnabled: true,
      nextReviewAt: now,
    });
    expect(
      manualChange(makeLearning({ practiceEnabled: false }), 'REMEMBERED', now),
    ).toMatchObject({ nextReviewAt: null });
  });
  it.each([
    ['REMEMBERED', { knowledge: 'REMEMBERED' }],
    ['UNKNOWN', { knowledge: 'UNKNOWN', practiceEnabled: false }],
    ['PRACTICE', { practiceEnabled: true }],
    ['PAUSE', { paused: true }],
    ['RESUME', { paused: false }],
    ['STOP_PRACTICE', { practiceEnabled: false }],
  ] as const)('%s is semantically idempotent', (action, overrides) => {
    expect(manualChange(makeLearning(overrides), action, now)).toBeNull();
  });
  it('paused and remembered without practice are excluded from today', () => {
    expect(isEnabled(makeLearning({ paused: true }))).toBe(false);
    expect(
      isEnabled(
        makeLearning({ knowledge: 'REMEMBERED', practiceEnabled: false }),
      ),
    ).toBe(false);
    expect(
      isEnabled(makeLearning({ knowledge: 'UNKNOWN', practiceEnabled: false })),
    ).toBe(true);
    expect(presentLearning(makeLearning())).not.toHaveProperty('memoryCard');
  });
});

describe('per-word FSRS evidence', () => {
  const evaluate = (
    overrides: Partial<Parameters<typeof scheduleWord>[0]> = {},
  ) =>
    scheduleWord({
      learning: makeLearning(),
      practice: makePractice(),
      assessment,
      now,
      timezone: 'Asia/Tokyo',
      earlierDueAttempt: false,
      ...overrides,
    });
  it('uses Good only for observed independent target/sense success', () => {
    const result = evaluate();
    expect(result.outcome).toBe('INDEPENDENT');
    expect(result.counted).toBe(true);
    expect(result.data).not.toHaveProperty('knowledge');
    expect(result.data).toHaveProperty(
      'memoryCard',
      expect.objectContaining({ reps: 1 }),
    );
  });
  it.each([1, 2, 3, 4])('hint %s is Hard, never independent', (hintLevel) => {
    expect(evaluate({ practice: makePractice({ hintLevel }) })).toMatchObject({
      outcome: 'PROMPTED',
      counted: true,
    });
  });
  it('initial unknown teaching is Hard and retains manual UNKNOWN', () => {
    const result = evaluate({
      practice: makePractice({ unknownAtStart: true }),
      learning: makeLearning({ knowledge: 'UNKNOWN', practiceEnabled: false }),
    });
    expect(result.outcome).toBe('PROMPTED');
    expect(result.data).not.toHaveProperty('knowledge');
    const independent = evaluate();
    expect(
      restoreCard((result.data as any).memoryCard, now).stability,
    ).toBeLessThan(
      restoreCard((independent.data as any).memoryCard, now).stability,
    );
  });
  it.each([
    { usedTarget: false },
    { targetCorrect: null },
    { meaningCorrect: null },
    { usedTarget: false, targetCorrect: false, meaningCorrect: false },
  ])('alternate/uncertain evidence abstains: %j', (values) => {
    const result = evaluate({ assessment: { ...assessment, ...values } });
    expect(result).toMatchObject({ outcome: 'UNVERIFIED', counted: false });
    expect(result.data).not.toHaveProperty('memoryCard');
    expect(result.data).not.toHaveProperty('nextReviewAt');
  });
  it('missing evidence cannot become success', () => {
    expect(wordOutcome({} as any, makePractice())).toBe('UNVERIFIED');
  });
  it('wrong target usage is Again even when the sentence is otherwise good', () => {
    expect(
      evaluate({ assessment: { ...assessment, targetCorrect: false } }),
    ).toMatchObject({
      outcome: 'INCORRECT',
      counted: true,
      data: { nextReviewAt: new Date(now.getTime() + 86_400_000) },
    });
  });
  it.each([{ dueAtStart: false }, {}])(
    'early/repeated successes preserve the due date and stability',
    (practice) => {
      const result = evaluate({
        practice: makePractice(practice),
        earlierDueAttempt: true,
      });
      expect(result.counted).toBe(false);
      expect(result.data).not.toHaveProperty('nextReviewAt');
      expect(result.data).not.toHaveProperty('memoryCard');
    },
  );
  it('does not advance a card already scheduled on the same local date', () => {
    const initial = evaluate();
    const result = evaluate({
      learning: makeLearning({ memoryCard: (initial.data as any).memoryCard }),
    });
    expect(result.counted).toBe(false);
    expect(result.data).not.toHaveProperty('memoryCard');
  });
  it('early failure shortens a future check without inflating stability', () => {
    const result = evaluate({
      learning: makeLearning({
        nextReviewAt: new Date(now.getTime() + 30 * 86_400_000),
      }),
      practice: makePractice({ dueAtStart: false }),
      assessment: { ...assessment, meaningCorrect: false },
    });
    expect(result).toMatchObject({
      counted: false,
      data: { nextReviewAt: new Date(now.getTime() + 86_400_000) },
    });
    expect(result.data).not.toHaveProperty('memoryCard');
  });
  it.each([
    { manualRevision: 2 },
    { knowledge: 'REMEMBERED', practiceEnabled: false },
    { paused: true },
  ])('fences old/disabled learning: %j', (learning) => {
    expect(evaluate({ learning: makeLearning(learning) })).toMatchObject({
      counted: false,
      data: null,
    });
  });
  it('round-trips card dates and deterministically caps intervals at 365 days', () => {
    let learning = makeLearning();
    for (let i = 0; i < 20; i++) {
      const time = learning.nextReviewAt!;
      const result = evaluate({ learning, now: time });
      const card = restoreCard((result.data as any).memoryCard, time);
      expect(card.due).toBeInstanceOf(Date);
      expect(card.last_review).toBeInstanceOf(Date);
      expect(card.scheduled_days).toBeLessThanOrEqual(365);
      expect(evaluate({ learning, now: time })).toEqual(result);
      learning = { ...learning, ...result.data } as typeof learning;
    }
  });
});

describe('local-day boundaries', () => {
  it.each([
    [
      'Asia/Tokyo',
      '2026-09-12T14:59:59Z',
      '2026-09-11T15:00:00Z',
      '2026-09-12T15:00:00Z',
    ],
    [
      'America/New_York',
      '2026-03-08T12:00:00Z',
      '2026-03-08T05:00:00Z',
      '2026-03-09T04:00:00Z',
    ],
    [
      'America/New_York',
      '2026-11-01T12:00:00Z',
      '2026-11-01T04:00:00Z',
      '2026-11-02T05:00:00Z',
    ],
  ])('%s on %s', (timezone, date, start, end) => {
    expect(localDayBounds(timezone, new Date(date))).toEqual({
      gte: new Date(start),
      lt: new Date(end),
    });
  });
});
