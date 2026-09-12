import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs';
import type {
  Prisma,
  VocabularyLearning,
  VocabularyPractice,
} from '@prisma/client';
import { localDateKey } from '../review/adaptive-review';
import type { WordAssessment } from './vocabulary-ai.schema';
import { isEnabled } from './vocabulary-learning.policy';

const scheduler = fsrs({
  request_retention: 0.9,
  maximum_interval: 365,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});
export type WordOutcome =
  'INDEPENDENT' | 'PROMPTED' | 'INCORRECT' | 'UNVERIFIED';

export function wordOutcome(
  a: Pick<WordAssessment, 'usedTarget' | 'targetCorrect' | 'meaningCorrect'>,
  exposure: Pick<VocabularyPractice, 'unknownAtStart' | 'hintLevel'>,
): WordOutcome {
  if (a.usedTarget !== true) return 'UNVERIFIED';
  if (a.targetCorrect === false || a.meaningCorrect === false)
    return 'INCORRECT';
  if (a.targetCorrect !== true || a.meaningCorrect !== true)
    return 'UNVERIFIED';
  return exposure.unknownAtStart || exposure.hintLevel > 0
    ? 'PROMPTED'
    : 'INDEPENDENT';
}

export function restoreCard(value: Prisma.JsonValue, now: Date): Card {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return createEmptyCard(now);
  const card = value as unknown as Card;
  if (
    ![
      'stability',
      'difficulty',
      'elapsed_days',
      'scheduled_days',
      'reps',
      'lapses',
      'state',
    ].every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key]),
    )
  )
    return createEmptyCard(now);
  const due = new Date(card.due);
  const last_review = card.last_review ? new Date(card.last_review) : undefined;
  if (
    !Number.isFinite(due.getTime()) ||
    (last_review && !Number.isFinite(last_review.getTime()))
  )
    return createEmptyCard(now);
  return { ...card, due, last_review };
}

/** Caller locks learning and supplies whether an earlier due attempt consumed this local day. */
export function scheduleWord(input: {
  learning: VocabularyLearning;
  practice: VocabularyPractice;
  assessment: WordAssessment;
  now: Date;
  timezone: string;
  earlierDueAttempt: boolean;
}) {
  const { learning, practice, assessment, now, timezone } = input;
  const outcome = wordOutcome(assessment, practice);
  if (
    learning.manualRevision !== practice.learningRevision ||
    !isEnabled(learning)
  )
    return { outcome, counted: false, data: null };
  const card = restoreCard(learning.memoryCard, now);
  card.due = learning.nextReviewAt ?? now;
  const sameDay =
    card.last_review &&
    localDateKey(timezone, card.last_review) === localDateKey(timezone, now);
  const eligible = practice.dueAtStart && !input.earlierDueAttempt && !sameDay;
  const base = { lastPracticedAt: now, lastOutcome: outcome };
  if (outcome === 'UNVERIFIED') return { outcome, counted: false, data: base };
  if (!eligible) {
    // Early or repeated failures can bring a future check closer without changing FSRS evidence.
    const tomorrow = new Date(now.getTime() + 86_400_000);
    return {
      outcome,
      counted: false,
      data: {
        ...base,
        ...(outcome === 'INCORRECT' &&
        learning.nextReviewAt &&
        learning.nextReviewAt > tomorrow
          ? { nextReviewAt: tomorrow }
          : {}),
      },
    };
  }
  const rating =
    outcome === 'INDEPENDENT'
      ? Rating.Good
      : outcome === 'PROMPTED'
        ? Rating.Hard
        : Rating.Again;
  const next = scheduler.next(card, now, rating).card;
  const days = Math.max(1, Math.min(365, Math.round(next.scheduled_days)));
  // A failed mature word needs a short follow-up; a Hard answer retains the FSRS Hard interval.
  const due = new Date(
    now.getTime() + (outcome === 'INCORRECT' ? 1 : days) * 86_400_000,
  );
  next.due = due;
  next.scheduled_days = outcome === 'INCORRECT' ? 1 : days;
  return {
    outcome,
    counted: true,
    data: {
      ...base,
      nextReviewAt: due,
      memoryCard: JSON.parse(JSON.stringify(next)) as Prisma.InputJsonValue,
    },
  };
}
