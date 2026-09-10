import {
  MemoryStateSource,
  RecallRating,
  ReviewMemoryState,
} from '@prisma/client';
import { createEmptyCard, fsrs, Rating, State, type Card } from 'ts-fsrs';

export const ADAPTIVE_ALGORITHM_VERSION = 'adaptive-v1';
export const ADAPTIVE_PROFILE_ID = 'adaptive-v1-default';
export const SCHEDULER_PACKAGE_VERSION = '5.4.1';
export const AI_SCORE_POLICY_VERSION = 'ai-score-v2';
export const TARGET_RETENTION = 0.9;
export const MIN_INTERVAL_DAYS = 1;
export const MAX_INTERVAL_DAYS = 365;
export type ReviewAlgorithmMode = 'legacy' | 'shadow' | 'adaptive';

const scheduler = fsrs({
  request_retention: TARGET_RETENTION,
  maximum_interval: MAX_INTERVAL_DAYS,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
});

export interface AiReviewEvidence {
  totalScore: number;
  usedTargetGrammar: boolean | null;
  targetGrammarCorrect: boolean | null;
}

export interface RatingResolution {
  effectiveRating: RecallRating;
  aiEvidence: 'UNAVAILABLE' | 'HARD_FAILURE' | 'QUALITY_CAP' | 'ACCEPTED';
}

export type RecallPolicyReason =
  | 'NONE'
  | 'SCORE_BELOW_80'
  | 'TARGET_GRAMMAR_MISSING'
  | 'TARGET_GRAMMAR_INCORRECT';

export interface RecallPolicy {
  allowedRatings: RecallRating[];
  effectiveRatingCap: RecallRating | null;
  reason: RecallPolicyReason;
  scorePolicyVersion: typeof AI_SCORE_POLICY_VERSION;
}

export interface StoredReviewState {
  nextReviewAt: Date;
  nextReviewOn: Date | null;
  algorithmVersion?: string;
  lastReviewAt: Date | null;
  stability: number | null;
  difficulty: number | null;
  fsrsState: ReviewMemoryState | null;
  scheduledDays: number | null;
  elapsedDays: number | null;
  reps: number;
  lapses: number;
  stateSource: MemoryStateSource | null;
}

export interface AdaptiveReviewOutcome {
  algorithmVersion: typeof ADAPTIVE_ALGORITHM_VERSION;
  profileId: typeof ADAPTIVE_PROFILE_ID;
  nextReviewAt: Date;
  nextReviewOn: Date;
  intervalDays: number;
  elapsedDays: number;
  stabilityBefore: number | null;
  stabilityAfter: number;
  difficultyBefore: number | null;
  difficultyAfter: number;
  retrievabilityBefore: number | null;
  fsrsState: ReviewMemoryState;
  reps: number;
  lapses: number;
  stateSource: MemoryStateSource;
}

export function resolveRating(
  submitted: RecallRating,
  evidence?: AiReviewEvidence,
): RatingResolution {
  if (submitted === RecallRating.FORGOT)
    return {
      effectiveRating: RecallRating.FORGOT,
      aiEvidence: evidence ? 'ACCEPTED' : 'UNAVAILABLE',
    };
  if (!evidence)
    return { effectiveRating: submitted, aiEvidence: 'UNAVAILABLE' };
  if (
    evidence.usedTargetGrammar === false ||
    evidence.targetGrammarCorrect === false
  )
    return {
      effectiveRating: RecallRating.FORGOT,
      aiEvidence: 'HARD_FAILURE',
    };
  if (submitted === RecallRating.REMEMBERED && evidence.totalScore < 80)
    return {
      effectiveRating: RecallRating.FUZZY,
      aiEvidence: 'QUALITY_CAP',
    };
  return { effectiveRating: submitted, aiEvidence: 'ACCEPTED' };
}

export function recallPolicyForEvidence(
  evidence: AiReviewEvidence,
): RecallPolicy {
  if (evidence.usedTargetGrammar === false)
    return limitedRecallPolicy(RecallRating.FORGOT, 'TARGET_GRAMMAR_MISSING');
  if (evidence.targetGrammarCorrect === false)
    return limitedRecallPolicy(RecallRating.FORGOT, 'TARGET_GRAMMAR_INCORRECT');
  if (evidence.totalScore < 80)
    return limitedRecallPolicy(RecallRating.FUZZY, 'SCORE_BELOW_80');
  return {
    allowedRatings: [
      RecallRating.FORGOT,
      RecallRating.FUZZY,
      RecallRating.REMEMBERED,
    ],
    effectiveRatingCap: null,
    reason: 'NONE',
    scorePolicyVersion: AI_SCORE_POLICY_VERSION,
  };
}

function limitedRecallPolicy(
  effectiveRatingCap: RecallRating,
  reason: Exclude<RecallPolicyReason, 'NONE'>,
): RecallPolicy {
  return {
    allowedRatings: [RecallRating.FORGOT, RecallRating.FUZZY],
    effectiveRatingCap,
    reason,
    scorePolicyVersion: AI_SCORE_POLICY_VERSION,
  };
}

export function algorithmModeForUser(
  configured: ReviewAlgorithmMode,
  rolloutPercent: number,
  userId: string,
) {
  if (configured !== 'adaptive') return configured;
  return stableBucket(userId) < rolloutPercent ? 'adaptive' : 'shadow';
}

export function calculateAdaptiveReview({
  schedule,
  rating,
  now = new Date(),
  timezone,
}: {
  schedule?: StoredReviewState | null;
  rating: RecallRating;
  now?: Date;
  timezone: string;
}): AdaptiveReviewOutcome {
  const card = toCard(schedule, now);
  const stabilityBefore = schedule?.stability ?? null;
  const difficultyBefore = schedule?.difficulty ?? null;
  const retrievabilityBefore = schedule?.lastReviewAt
    ? scheduler.get_retrievability(card, now, false)
    : null;
  const result = scheduler.next(card, now, toFsrsRating(rating));
  const intervalDays = clampInterval(result.card.scheduled_days);
  const today = localDateKey(timezone, now);
  const nextKey = addCalendarDays(today, intervalDays);
  const nextReviewOn = new Date(`${nextKey}T00:00:00.000Z`);
  return {
    algorithmVersion: ADAPTIVE_ALGORITHM_VERSION,
    profileId: ADAPTIVE_PROFILE_ID,
    nextReviewAt: nextReviewOn,
    nextReviewOn,
    intervalDays,
    elapsedDays: schedule?.lastReviewAt
      ? calendarDayDifference(
          localDateKey(timezone, schedule.lastReviewAt),
          today,
        )
      : 0,
    stabilityBefore,
    stabilityAfter: result.card.stability,
    difficultyBefore,
    difficultyAfter: result.card.difficulty,
    retrievabilityBefore,
    fsrsState: fromFsrsState(result.card.state),
    reps: result.card.reps,
    lapses: result.card.lapses,
    stateSource: MemoryStateSource.NATIVE,
  };
}

export function estimatedRetrievability(
  schedule: StoredReviewState,
  now = new Date(),
) {
  if (!schedule.lastReviewAt || !schedule.stability) return null;
  return scheduler.get_retrievability(toCard(schedule, now), now, false);
}

export function localDateKey(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function addCalendarDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarDayDifference(fromKey: string, toKey: string) {
  const from = new Date(`${fromKey}T00:00:00.000Z`).getTime();
  const to = new Date(`${toKey}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function toCard(schedule: StoredReviewState | null | undefined, now: Date) {
  if (
    !schedule ||
    schedule.stability === null ||
    schedule.difficulty === null ||
    schedule.fsrsState === null
  )
    return createEmptyCard(now);
  return {
    due: schedule.nextReviewAt,
    stability: schedule.stability,
    difficulty: schedule.difficulty,
    elapsed_days: schedule.elapsedDays ?? 0,
    scheduled_days: schedule.scheduledDays ?? MIN_INTERVAL_DAYS,
    learning_steps: 0,
    reps: schedule.reps,
    lapses: schedule.lapses,
    state: toFsrsState(schedule.fsrsState),
    last_review: schedule.lastReviewAt ?? undefined,
  } satisfies Card;
}

function toFsrsRating(rating: RecallRating) {
  if (rating === RecallRating.FORGOT) return Rating.Again;
  if (rating === RecallRating.FUZZY) return Rating.Hard;
  return Rating.Good;
}

function toFsrsState(state: ReviewMemoryState) {
  return {
    [ReviewMemoryState.NEW]: State.New,
    [ReviewMemoryState.LEARNING]: State.Learning,
    [ReviewMemoryState.REVIEW]: State.Review,
    [ReviewMemoryState.RELEARNING]: State.Relearning,
  }[state];
}

function fromFsrsState(state: State) {
  return {
    [State.New]: ReviewMemoryState.NEW,
    [State.Learning]: ReviewMemoryState.LEARNING,
    [State.Review]: ReviewMemoryState.REVIEW,
    [State.Relearning]: ReviewMemoryState.RELEARNING,
  }[state];
}

function clampInterval(days: number) {
  return Math.max(
    MIN_INTERVAL_DAYS,
    Math.min(MAX_INTERVAL_DAYS, Math.round(days)),
  );
}

function stableBucket(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}
