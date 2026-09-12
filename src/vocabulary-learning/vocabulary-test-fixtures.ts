import type { VocabularyLearning } from '@prisma/client';
import type { PracticeRecord } from './vocabulary-practice.presenter';

// @types/jest returns `any` for asymmetric matchers. Keep that boundary typed
// so nested expected objects do not spread `any` through test assertions.
export function contains(
  value: Record<string, unknown>,
): jest.AsymmetricMatcher {
  return expect.objectContaining(value) as jest.AsymmetricMatcher;
}
export function excludes(
  value: Record<string, unknown>,
): jest.AsymmetricMatcher {
  return expect.not.objectContaining(value) as jest.AsymmetricMatcher;
}

export const now = new Date('2026-09-12T10:00:00.000Z');
export const challenge = {
  promptZh: '告诉朋友周末去哪里。',
  meaningHintZh: '表示抵达某个地方。',
  grammarId: null,
  referenceSentence: '明日、駅に着きます。',
  referenceFurigana: '明日[あした]、駅[えき]に着[つ]きます。',
  referenceTranslationZh: '明天到车站。',
  chunks: ['明日、', '駅に', '着きます。'],
};
export const assessment = {
  usedTarget: true,
  targetCorrect: true,
  meaningCorrect: true,
  readingCorrect: null,
  explanationZh: '正确使用了目标词义。',
  corrections: [],
  correctedSentence: '明日、駅に着きます。',
  correctedFurigana: '明日[あした]、駅[えき]に着[つ]きます。',
  correctedTranslationZh: '明天到车站。',
};
export const input = {
  word: '着く',
  reading: 'つく',
  chineseGloss: '到达',
  senseKey: 'arrival',
  glosses: ['arrive'],
  grammars: [],
  previousPrompts: [],
};

export function makeLearning(
  overrides: Partial<VocabularyLearning> = {},
): VocabularyLearning {
  return {
    id: 'learning',
    userId: 'owner',
    vocabularyId: 'sense-arrival',
    knowledge: 'KNOWN',
    practiceEnabled: true,
    paused: false,
    manualRevision: 1,
    nextReviewAt: now,
    lastPracticedAt: null,
    lastOutcome: null,
    memoryCard: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
export function makePractice(
  overrides: Partial<PracticeRecord> = {},
): PracticeRecord {
  return {
    id: 'practice',
    userId: 'owner',
    vocabularyId: 'sense-arrival',
    learningId: 'learning',
    grammarId: null,
    linkedStudySessionId: null,
    status: 'READY',
    learningRevision: 1,
    unknownAtStart: false,
    dueAtStart: true,
    counted: false,
    challenge: { ...challenge, _input: input },
    answer: null,
    requestKey: null,
    hintLevel: 0,
    assessment: null,
    attempts: 0,
    lockedAt: null,
    availableAt: now,
    errorCode: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
    learning: makeLearning(),
    grammar: null,
    vocabulary: {
      id: 'sense-arrival',
      ownerId: null,
      fingerprint: 'fp',
      word: '着く',
      reading: 'つく',
      senseKey: 'arrival',
      partOfSpeech: ['verb'],
      glosses: ['arrive'],
      chineseGloss: '到达',
      chineseGlossSource: 'test',
      level: 'N4',
      levelSource: 'test',
      sourceName: 'test',
      sourceUrl: null,
      sourceVersion: '1',
      sourceEntryId: null,
      license: null,
      validationStatus: 'VALIDATED',
      provenance: {},
      createdAt: now,
      updatedAt: now,
    },
    ...overrides,
  };
}
