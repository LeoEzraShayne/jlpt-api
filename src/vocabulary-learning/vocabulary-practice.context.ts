import type { PrismaService } from '../database/prisma.service';
import type { AiVocabularyInput } from './vocabulary-ai.schema';
import type { PracticeRecord } from './vocabulary-practice.presenter';
import { readChallenge } from './vocabulary-practice.presenter';

export async function vocabularyInput(
  prisma: PrismaService,
  job: PracticeRecord,
): Promise<AiVocabularyInput> {
  const selected = job.grammar?.status === 'PUBLISHED' ? [job.grammar] : [];
  const learned = await prisma.userGrammarProgress.findMany({
    where: {
      userId: job.userId,
      status: { not: 'NOT_STARTED' },
      grammar: { status: 'PUBLISHED' },
      ...(selected.length ? { grammarId: { not: selected[0].id } } : {}),
    },
    include: { grammar: true },
    orderBy: [{ lastStudiedAt: 'desc' }, { id: 'asc' }],
    take: 5 - selected.length,
  });
  const previous = await prisma.vocabularyPractice.findMany({
    where: {
      userId: job.userId,
      vocabularyId: job.vocabularyId,
      id: { not: job.id },
    },
    select: { challenge: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  return {
    word: job.vocabulary.word,
    reading: job.vocabulary.reading,
    chineseGloss: job.vocabulary.chineseGloss ?? '',
    senseKey: job.vocabulary.senseKey,
    glosses: job.vocabulary.glosses as AiVocabularyInput['glosses'],
    grammars: [...selected, ...learned.map((p) => p.grammar)].map((g) => ({
      id: g.id,
      title: g.title,
      chineseExplanation: g.chineseExplanation,
      ...(g.connectionRule ? { connectionRule: g.connectionRule } : {}),
    })),
    previousPrompts: previous.flatMap((p) => {
      const c = readChallenge(p.challenge);
      return c ? [c.promptZh] : [];
    }),
  };
}

/** Input frozen with the challenge so retries grade the original sense/context. */
export function storedVocabularyInput(
  job: PracticeRecord,
): AiVocabularyInput | null {
  const value = job.challenge;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value._input;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof input.word !== 'string' ||
    typeof input.reading !== 'string' ||
    typeof input.senseKey !== 'string' ||
    !Array.isArray(input.grammars)
  )
    return null;
  return input as unknown as AiVocabularyInput;
}
