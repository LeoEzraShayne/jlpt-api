import { ProgressStatus, RecallRating, SessionMode } from '@prisma/client';
import {
  type AiReviewEvidence,
  resolveRating,
} from '../review/adaptive-review';

export const MASTERY_RULE_VERSION = 'mastery-v2';
export const SCENARIO_EVIDENCE_VERSION = 'scenario-v1';

export interface MasteryEvidence {
  evidenceVersion: string;
  firstAttemptId: string | null;
  firstScore: number | null;
  targetGrammarCorrect: boolean | null;
  dueReview: boolean;
  reviewDate: Date | null;
  submittedRating: RecallRating;
  effectiveRating: RecallRating;
  hintRevealCount: number;
  scenarioTaskCompleted: boolean;
  crossScenarioValid: boolean;
}

export function validScore(score: unknown): score is number {
  return (
    typeof score === 'number' &&
    Number.isInteger(score) &&
    score >= 0 &&
    score <= 100
  );
}

export function resolveEvidenceRating(
  submitted: RecallRating,
  evidence: AiReviewEvidence | undefined,
  hintRevealCount: number,
) {
  const hasScore = validScore(evidence?.totalScore);
  const resolution = resolveRating(submitted, hasScore ? evidence : undefined);
  const confirmedTarget =
    evidence?.usedTargetGrammar === true &&
    evidence.targetGrammarCorrect === true;
  if (resolution.effectiveRating === RecallRating.FORGOT)
    return { ...resolution, hasScore, confirmedTarget };
  if (!hasScore || !confirmedTarget || hintRevealCount > 0) {
    return {
      effectiveRating: RecallRating.FUZZY,
      aiEvidence: !hasScore
        ? ('UNAVAILABLE' as const)
        : ('QUALITY_CAP' as const),
      hasScore,
      confirmedTarget,
    };
  }
  return { ...resolution, hasScore, confirmedTarget };
}

export function isDueReview(input: {
  mode: SessionMode;
  today: string;
  sessionStartedOn: string;
  scheduledOn: string | null;
  previousDueDate: string | null;
}) {
  return (
    input.mode === SessionMode.REVIEW &&
    input.scheduledOn !== null &&
    input.scheduledOn <= input.today &&
    input.sessionStartedOn >= input.scheduledOn &&
    input.previousDueDate !== input.today
  );
}

export function qualifiesForMastery(event: MasteryEvidence) {
  return (
    event.evidenceVersion === MASTERY_RULE_VERSION &&
    event.dueReview &&
    event.firstAttemptId !== null &&
    event.reviewDate !== null &&
    validScore(event.firstScore) &&
    event.firstScore >= 80 &&
    event.targetGrammarCorrect === true &&
    event.hintRevealCount === 0 &&
    event.submittedRating === RecallRating.REMEMBERED &&
    event.effectiveRating === RecallRating.REMEMBERED
  );
}

export function resolveEvidenceStatus(input: {
  previousStatus: ProgressStatus;
  current: MasteryEvidence;
  recentDueEvents: MasteryEvidence[];
  stability: number | null;
  assessed: boolean;
}) {
  const { current } = input;
  if (
    current.effectiveRating === RecallRating.FORGOT ||
    current.targetGrammarCorrect === false
  )
    return ProgressStatus.NEEDS_WORK;
  // An unavailable result cannot claim success or revoke established mastery.
  if (
    !input.assessed &&
    current.submittedRating === RecallRating.REMEMBERED &&
    current.hintRevealCount === 0
  )
    return input.previousStatus;
  if (
    current.effectiveRating !== RecallRating.REMEMBERED ||
    current.hintRevealCount > 0
  )
    return ProgressStatus.LEARNING;
  if (!current.dueReview) return input.previousStatus;
  // Callers supply the latest due reviews, not just the successful reviews.
  const lastThree = [current, ...input.recentDueEvents].slice(0, 3);
  const days = new Set(
    lastThree.map((e) => e.reviewDate?.toISOString().slice(0, 10)),
  );
  if (
    lastThree.length === 3 &&
    days.size === 3 &&
    lastThree.every(qualifiesForMastery) &&
    lastThree.some((e) => e.crossScenarioValid && e.scenarioTaskCompleted) &&
    (input.stability ?? 0) >= 30
  )
    return ProgressStatus.MASTERED;
  // Legacy mastery needs actual V2 evidence to be confirmed; never fabricate it.
  return ProgressStatus.LEARNING;
}

/** Persisted by the server's scene assignment, never accepted from completion DTOs. */
export interface ScenarioContext {
  version: typeof SCENARIO_EVIDENCE_VERSION;
  scenarioId: string;
  taskId: string;
  objectiveId: string;
  register: string;
}

export function readScenarioContext(context: unknown): ScenarioContext | null {
  if (!context || typeof context !== 'object' || !('scenario' in context))
    return null;
  const scenario = context.scenario;
  if (!scenario || typeof scenario !== 'object') return null;
  const value = scenario as Record<string, unknown>;
  if (
    value.version !== SCENARIO_EVIDENCE_VERSION ||
    !['scenarioId', 'taskId', 'objectiveId', 'register'].every(
      (key) => typeof value[key] === 'string' && value[key].length > 0,
    )
  )
    return null;
  return value as unknown as ScenarioContext;
}

export function validateScenarioEvidence(input: {
  scenarioId: string | null;
  trainingMode: string | null;
  trainingContext: unknown;
  taskCompleted: boolean | null | undefined;
  previous: { scenarioId: string | null; trainingContext: unknown }[];
}) {
  const current = readScenarioContext(input.trainingContext);
  const scenarioTaskCompleted =
    !!current &&
    current.scenarioId === input.scenarioId &&
    input.taskCompleted === true;
  const crossScenarioValid =
    scenarioTaskCompleted &&
    input.trainingMode === 'TRANSFER' &&
    input.previous.some((previous) => {
      const other = readScenarioContext(previous.trainingContext);
      const currentVersion = (
        input.trainingContext as { selectionVersion?: string }
      )?.selectionVersion;
      const previousVersion = (
        previous.trainingContext as { selectionVersion?: string } | null
      )?.selectionVersion;
      return (
        (!currentVersion || currentVersion === previousVersion) &&
        !!current &&
        !!other &&
        other.scenarioId === previous.scenarioId &&
        other.scenarioId !== current.scenarioId &&
        other.objectiveId !== current.objectiveId &&
        other.taskId !== current.taskId
      );
    });
  return { scenarioTaskCompleted, crossScenarioValid };
}
