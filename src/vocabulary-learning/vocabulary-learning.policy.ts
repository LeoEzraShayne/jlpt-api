import type { VocabularyLearning } from '@prisma/client';
import type { ManualAction } from './vocabulary-learning.dto';

export const OPEN_STATUSES = ['QUEUED', 'GENERATING', 'READY', 'ASSESSING'];
export const MAX_ATTEMPTS = 3;

export function visibleVocabulary(userId: string) {
  return {
    validationStatus: 'VALIDATED',
    OR: [{ ownerId: null }, { ownerId: userId }],
  };
}

export function enabledLearning() {
  return { OR: [{ knowledge: 'UNKNOWN' }, { practiceEnabled: true }] };
}

export function dueLearning(now = new Date(), day?: { gte: Date; lt: Date }) {
  return {
    ...enabledLearning(),
    paused: false,
    nextReviewAt: { lte: now },
    ...(day
      ? {
          practices: {
            none: {
              status: { in: ['COMPLETED', 'FAILED'] },
              answer: { not: null },
              dueAtStart: true,
              OR: [{ createdAt: day }, { completedAt: day }],
            },
          },
        }
      : {}),
  };
}

export function isEnabled(learning: VocabularyLearning) {
  return (
    !learning.paused &&
    (learning.knowledge === 'UNKNOWN' || learning.practiceEnabled)
  );
}

/** A semantic no-op leaves both the revision and due date untouched. */
export function manualChange(
  learning: VocabularyLearning,
  action: ManualAction,
  now: Date,
) {
  let { knowledge, practiceEnabled, paused, nextReviewAt } = learning;
  switch (action) {
    case 'UNKNOWN':
      if (knowledge === 'UNKNOWN' && !practiceEnabled) return null;
      knowledge = 'UNKNOWN';
      practiceEnabled = false;
      nextReviewAt = now;
      break;
    case 'PRACTICE':
      if (practiceEnabled) return null;
      if (knowledge === 'UNKNOWN') knowledge = 'KNOWN';
      practiceEnabled = true;
      nextReviewAt ??= now;
      break;
    case 'REMEMBERED':
      if (knowledge === 'REMEMBERED') return null;
      knowledge = 'REMEMBERED';
      if (!practiceEnabled) nextReviewAt = null;
      break;
    case 'PAUSE':
      if (paused) return null;
      paused = true;
      break;
    case 'RESUME':
      if (!paused) return null;
      paused = false;
      break;
    case 'STOP_PRACTICE':
      if (!practiceEnabled) return null;
      practiceEnabled = false;
      if (knowledge !== 'UNKNOWN') nextReviewAt = null;
      break;
  }
  return {
    knowledge,
    practiceEnabled,
    paused,
    nextReviewAt,
    manualRevision: { increment: 1 },
  };
}

export function presentLearning(row: VocabularyLearning) {
  return {
    id: row.id,
    vocabularyId: row.vocabularyId,
    knowledge: row.knowledge,
    practiceEnabled: row.practiceEnabled,
    paused: row.paused,
    manualRevision: row.manualRevision,
    nextReviewAt: row.nextReviewAt,
    lastPracticedAt: row.lastPracticedAt,
    lastOutcome: row.lastOutcome,
  };
}
