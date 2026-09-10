import { ProgressStatus, RecallRating, SessionMode } from '@prisma/client';
import {
  isDueReview,
  MASTERY_RULE_VERSION,
  resolveEvidenceRating,
  resolveEvidenceStatus,
  validateScenarioEvidence,
  type MasteryEvidence,
} from './review-evidence';

const good = (
  day: number,
  patch: Partial<MasteryEvidence> = {},
): MasteryEvidence => ({
  evidenceVersion: MASTERY_RULE_VERSION,
  firstAttemptId: `attempt-${day}`,
  firstScore: 80,
  targetGrammarCorrect: true,
  dueReview: true,
  reviewDate: new Date(`2026-08-${day}T00:00:00Z`),
  submittedRating: RecallRating.REMEMBERED,
  effectiveRating: RecallRating.REMEMBERED,
  hintRevealCount: 0,
  scenarioTaskCompleted: true,
  crossScenarioValid: false,
  ...patch,
});
const status = (
  current = good(20),
  recent = [good(18, { crossScenarioValid: true }), good(15)],
  stability = 30,
) =>
  resolveEvidenceStatus({
    previousStatus: ProgressStatus.LEARNING,
    current,
    recentDueEvents: recent,
    stability,
    assessed: true,
  });

describe('V2 first-submission evidence', () => {
  it('requires three distinct due dates and accepts the 80-point boundary', () => {
    expect(status()).toBe(ProgressStatus.MASTERED);
    expect(status(good(20, { firstScore: 79 }))).toBe(ProgressStatus.LEARNING);
    expect(status(good(20, { firstScore: 100 }))).toBe(ProgressStatus.MASTERED);
  });
  it.each([
    { firstScore: null },
    { firstScore: NaN },
    { firstScore: 101 },
    { firstAttemptId: null },
    { hintRevealCount: 1 },
    { targetGrammarCorrect: null },
    { dueReview: false },
    { evidenceVersion: 'legacy-v1' },
    { submittedRating: RecallRating.FUZZY },
  ])('rejects unqualified current evidence %j', (patch) => {
    expect(status(good(20, patch))).not.toBe(ProgressStatus.MASTERED);
  });
  it('does not skip a failed due review to use older successes', () => {
    expect(
      status(good(20), [
        good(18, { firstScore: 79, crossScenarioValid: true }),
        good(15),
        good(12),
      ]),
    ).toBe(ProgressStatus.LEARNING);
  });
  it('requires actual transfer and a 30-day stability estimate', () => {
    expect(status(good(20), [good(18), good(15)])).toBe(
      ProgressStatus.LEARNING,
    );
    expect(status(good(20), undefined, 29.99)).toBe(ProgressStatus.LEARNING);
    expect(
      status(good(20), [good(20, { crossScenarioValid: true }), good(15)]),
    ).toBe(ProgressStatus.LEARNING);
  });
  it('preserves mastery without valid scoring and never infers evidence from age', () => {
    expect(
      resolveEvidenceStatus({
        previousStatus: ProgressStatus.MASTERED,
        current: good(20, { firstScore: null }),
        recentDueEvents: [],
        stability: 100,
        assessed: false,
      }),
    ).toBe(ProgressStatus.MASTERED);
  });
  it('demotes forgotten or incorrect target grammar without clearing history', () => {
    expect(status(good(20, { effectiveRating: RecallRating.FORGOT }))).toBe(
      ProgressStatus.NEEDS_WORK,
    );
    expect(status(good(20, { targetGrammarCorrect: false }))).toBe(
      ProgressStatus.NEEDS_WORK,
    );
  });
  it('caps unscored, hinted and target-unverified recall rather than claiming success', () => {
    const ai = {
      totalScore: 80,
      usedTargetGrammar: true,
      targetGrammarCorrect: true,
    };
    expect(
      resolveEvidenceRating(RecallRating.REMEMBERED, ai, 0).effectiveRating,
    ).toBe(RecallRating.REMEMBERED);
    expect(
      resolveEvidenceRating(
        RecallRating.REMEMBERED,
        { ...ai, totalScore: 79 },
        0,
      ).effectiveRating,
    ).toBe(RecallRating.FUZZY);
    expect(
      resolveEvidenceRating(RecallRating.REMEMBERED, ai, 1).effectiveRating,
    ).toBe(RecallRating.FUZZY);
    expect(
      resolveEvidenceRating(RecallRating.REMEMBERED, undefined, 0),
    ).toMatchObject({ hasScore: false, effectiveRating: RecallRating.FUZZY });
    expect(
      resolveEvidenceRating(
        RecallRating.REMEMBERED,
        { ...ai, targetGrammarCorrect: null },
        0,
      ).effectiveRating,
    ).toBe(RecallRating.FUZZY);
  });
});

describe('due review eligibility', () => {
  const due = {
    mode: SessionMode.REVIEW,
    today: '2026-08-20',
    sessionStartedOn: '2026-08-20',
    scheduledOn: '2026-08-19',
    previousDueDate: '2026-08-18',
  };
  it('includes overdue reviews, excludes initial/early/practice and same-day retries', () => {
    expect(isDueReview(due)).toBe(true);
    for (const patch of [
      { mode: SessionMode.LEARN },
      { mode: SessionMode.PRACTICE },
      { scheduledOn: null },
      { scheduledOn: '2026-08-21' },
      { sessionStartedOn: '2026-08-18' },
      { previousDueDate: due.today },
    ])
      expect(isDueReview({ ...due, ...patch })).toBe(false);
  });
});

describe('server-persisted scenario hook', () => {
  const context = (id: string, objective: string) => ({
    scenario: {
      version: 'scenario-v1',
      scenarioId: id,
      taskId: `task-${id}`,
      objectiveId: objective,
      register: 'POLITE',
    },
  });
  const transfer = {
    scenarioId: 'work',
    trainingMode: 'TRANSFER',
    trainingContext: context('work', 'negotiate-deadline'),
    taskCompleted: true,
    previous: [
      {
        scenarioId: 'travel',
        trainingContext: context('travel', 'ask-directions'),
      },
    ],
  };
  it('accepts a completed new communicative objective', () => {
    expect(validateScenarioEvidence(transfer).crossScenarioValid).toBe(true);
  });
  it('rejects noun swaps, unverified legacy scenes, mismatched ids and uncompleted tasks', () => {
    expect(
      validateScenarioEvidence({
        ...transfer,
        trainingContext: context('work', 'ask-directions'),
      }).crossScenarioValid,
    ).toBe(false);
    for (const patch of [
      { trainingContext: {} },
      { scenarioId: 'invented' },
      { taskCompleted: false },
      { trainingMode: 'REPLACE' },
    ])
      expect(
        validateScenarioEvidence({ ...transfer, ...patch }).crossScenarioValid,
      ).toBe(false);
  });
});
