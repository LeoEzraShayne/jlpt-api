import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Challenge, WordAssessment } from './vocabulary-ai.schema';
import { wordOutcome } from './vocabulary-evidence';

export const practiceInclude = {
  vocabulary: true,
  learning: true,
  grammar: true,
} as const;
export type PracticeRecord = Prisma.VocabularyPracticeGetPayload<{
  include: typeof practiceInclude;
}>;

export function readChallenge(value: Prisma.JsonValue): Challenge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (
    typeof value.promptZh !== 'string' ||
    typeof value.meaningHintZh !== 'string' ||
    typeof value.referenceSentence !== 'string' ||
    typeof value.referenceFurigana !== 'string' ||
    typeof value.referenceTranslationZh !== 'string' ||
    !Array.isArray(value.chunks) ||
    !value.chunks.every((chunk) => typeof chunk === 'string')
  )
    return null;
  return value as unknown as Challenge;
}

/** Opaque occurrence IDs never encode the correct chunk order, even for duplicates. */
export function shuffledChunks(id: string, chunks: string[]) {
  const occurrences = new Map<string, number>();
  const result = chunks.map((text) => {
    const occurrence = occurrences.get(text) ?? 0;
    occurrences.set(text, occurrence + 1);
    // Do not hash the original ordinal: practice IDs are public and a client
    // could enumerate ordinal hashes to reconstruct the reference order.
    return {
      id: createHash('sha256')
        .update(JSON.stringify([id, text, occurrence]))
        .digest('hex')
        .slice(0, 20),
      text,
    };
  });
  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

export function presentPractice(row: PracticeRecord) {
  const challenge = readChallenge(row.challenge);
  const hints: {
    meaning?: string;
    reading?: string;
    word?: string;
    chunks?: Array<{ id: string; text: string }>;
  } = {};
  // Never spread database JSON into a response, including completed assessments.
  const publicRow = {
    id: row.id,
    explanationLocale: row.explanationLocale ?? 'zh',
    status: row.status,
    vocabularyId: row.vocabularyId,
    grammarId: row.grammarId,
    linkedStudySessionId: row.linkedStudySessionId,
    unknownAtStart: row.unknownAtStart,
    hintLevel: row.hintLevel,
    errorCode: row.errorCode,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    hints,
    ...(['ASSESSING', 'FAILED', 'COMPLETED'].includes(row.status) &&
    row.answer !== null
      ? { answer: row.answer }
      : {}),
  };
  if (!challenge) return publicRow;
  const exposed = ['READY', 'ASSESSING', 'COMPLETED', 'FAILED'].includes(
    row.status,
  );
  if (!exposed) return publicRow;
  if (row.hintLevel >= 1) hints.meaning = challenge.meaningHintZh;
  if (row.hintLevel >= 2) hints.reading = row.vocabulary.reading;
  if (row.hintLevel >= 3) hints.word = row.vocabulary.word;
  if (row.hintLevel >= 4)
    hints.chunks = shuffledChunks(row.id, challenge.chunks);
  const instruction = {
    ...publicRow,
    promptZh: challenge.promptZh,
    localized: {
      locale: row.explanationLocale ?? 'zh',
      prompt: challenge.promptZh,
      ...(row.hintLevel >= 1 ? { meaningHint: challenge.meaningHintZh } : {}),
      ...(row.status === 'COMPLETED'
        ? { referenceTranslation: challenge.referenceTranslationZh }
        : {}),
    },
    ...(row.grammar
      ? { grammar: { id: row.grammar.id, title: row.grammar.title } }
      : {}),
    ...(row.unknownAtStart
      ? {
          learningPreview: {
            localized: {
              locale: row.explanationLocale ?? 'zh',
              meaning:
                row.explanationLocale === 'en'
                  ? englishGloss(row.vocabulary.glosses)
                  : row.vocabulary.chineseGloss,
              exampleTranslation: challenge.referenceTranslationZh,
            },
            word: row.vocabulary.word,
            reading: row.vocabulary.reading,
            chineseGloss: row.vocabulary.chineseGloss,
            exampleSentence: challenge.referenceSentence,
            exampleFurigana: challenge.referenceFurigana,
            exampleTranslationZh: challenge.referenceTranslationZh,
          },
        }
      : {}),
  };
  if (row.status !== 'COMPLETED' || !row.assessment) return instruction;
  const a = row.assessment as unknown as WordAssessment;
  return {
    ...instruction,
    answer: row.answer,
    result: {
      outcome: wordOutcome(a, row),
      usedTarget: a.usedTarget === true,
      targetCorrect: a.targetCorrect ?? null,
      meaningCorrect: a.meaningCorrect ?? null,
      // Sentence production provides no observation of pronunciation.
      readingCorrect: null,
      localizedFeedback: {
        locale: row.explanationLocale ?? 'zh',
        explanation: a.explanationZh,
        correctedTranslation: a.correctedTranslationZh,
        corrections: a.corrections.map(({ text, replacement, reason }) => ({
          text,
          replacement,
          reason,
        })),
      },
      explanationZh: a.explanationZh,
      corrections: a.corrections.map(({ text, replacement, reason }) => ({
        text,
        replacement,
        reason,
      })),
      correctedSentence: a.correctedSentence,
      correctedFurigana: a.correctedFurigana,
      correctedTranslationZh: a.correctedTranslationZh,
    },
    reference: {
      sentence: challenge.referenceSentence,
      furigana: challenge.referenceFurigana,
      translationZh: challenge.referenceTranslationZh,
    },
    nextReviewAt: row.learning.nextReviewAt,
  };
}

function englishGloss(value: Prisma.JsonValue) {
  if (!Array.isArray(value)) return null;
  return (
    value
      .flatMap((g) =>
        g &&
        typeof g === 'object' &&
        !Array.isArray(g) &&
        typeof g.language === 'string' &&
        ['eng', 'en', 'English'].includes(g.language) &&
        typeof g.text === 'string'
          ? [g.text]
          : [],
      )
      .join('; ') || null
  );
}
