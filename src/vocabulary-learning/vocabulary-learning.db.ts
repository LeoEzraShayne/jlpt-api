import { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { visibleVocabulary } from './vocabulary-learning.policy';

export async function requireVocabulary(
  tx: Prisma.TransactionClient,
  userId: string,
  id: string,
) {
  const vocabulary = await tx.vocabularyEntry.findFirst({
    where: { id, ...visibleVocabulary(userId) },
  });
  if (!vocabulary) throw new NotFoundException('Vocabulary entry not found');
  return vocabulary;
}

/** Consistent lock order: learning first, practice second. No AI inside this transaction. */
export async function lockLearning(
  tx: Prisma.TransactionClient,
  userId: string,
  vocabularyId: string,
) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "VocabularyLearning"
    WHERE "userId"=${userId} AND "vocabularyId"=${vocabularyId} FOR UPDATE`);
  const learning = await tx.vocabularyLearning.findUnique({
    where: { userId_vocabularyId: { userId, vocabularyId } },
  });
  if (!learning) throw new NotFoundException('Vocabulary learning not found');
  return learning;
}
