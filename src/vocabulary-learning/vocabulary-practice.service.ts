import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { PrismaService } from '../database/prisma.service';
import { lockLearning, requireVocabulary } from './vocabulary-learning.db';
import {
  dueLearning,
  isEnabled,
  MAX_ATTEMPTS,
  OPEN_STATUSES,
  visibleVocabulary,
} from './vocabulary-learning.policy';
import {
  practiceInclude,
  presentPractice,
} from './vocabulary-practice.presenter';
import type {
  StartVocabularyPracticeDto,
  VocabularyAnswerDto,
} from './vocabulary-learning.dto';

@Injectable()
export class VocabularyPracticeService {
  constructor(private readonly prisma: PrismaService) {}

  async start(userId: string, input: StartVocabularyPracticeDto) {
    let vocabularyId = input.vocabularyId;
    if (!vocabularyId) {
      const due = await this.prisma.vocabularyLearning.findFirst({
        where: {
          userId,
          ...dueLearning(),
          vocabulary: visibleVocabulary(userId),
        },
        orderBy: [{ nextReviewAt: 'asc' }, { id: 'asc' }],
      });
      if (!due) throw new NotFoundException('No vocabulary due');
      vocabularyId = due.vocabularyId;
    }
    const id = vocabularyId;
    return this.prisma.$transaction(async (tx) => {
      await requireVocabulary(tx, userId, id);
      const learning = await lockLearning(tx, userId, id);
      if (!isEnabled(learning))
        throw new ConflictException('Vocabulary learning is not enabled');
      let grammarId = input.grammarId;
      if (input.studySessionId) {
        const session = await tx.studySession.findFirst({
          where: {
            id: input.studySessionId,
            userId,
            status: 'ACTIVE',
            grammar: { status: 'PUBLISHED' },
          },
        });
        if (!session)
          throw new NotFoundException('Active study session not found');
        if (grammarId && grammarId !== session.grammarId)
          throw new BadRequestException('Grammar does not match study session');
        grammarId = session.grammarId;
      }
      if (
        grammarId &&
        !(await tx.grammarPoint.findFirst({
          where: { id: grammarId, status: 'PUBLISHED' },
        }))
      )
        throw new NotFoundException('Published grammar not found');
      const existing = await tx.vocabularyPractice.findFirst({
        where: { learningId: learning.id, status: { in: OPEN_STATUSES } },
        include: practiceInclude,
      });
      if (existing) return presentPractice(existing);
      const now = new Date();
      const practice = await tx.vocabularyPractice.create({
        data: {
          userId,
          vocabularyId: id,
          learningId: learning.id,
          grammarId,
          linkedStudySessionId: input.studySessionId,
          learningRevision: learning.manualRevision,
          unknownAtStart: learning.knowledge === 'UNKNOWN',
          dueAtStart: !!learning.nextReviewAt && learning.nextReviewAt <= now,
        },
        include: practiceInclude,
      });
      return presentPractice(practice);
    });
  }

  private async owned(userId: string, id: string) {
    const row = await this.prisma.vocabularyPractice.findFirst({
      where: { id, userId, vocabulary: visibleVocabulary(userId) },
      include: practiceInclude,
    });
    if (!row) throw new NotFoundException('Vocabulary practice not found');
    return row;
  }

  async get(userId: string, id: string) {
    return presentPractice(await this.owned(userId, id));
  }

  async hint(userId: string, id: string) {
    // Compare-and-swap with answer submission on the same row. Exposure is durable
    // before returning, and cannot change after ASSESSING has won the race.
    for (let tries = 0; tries < 8; tries++) {
      const row = await this.owned(userId, id);
      if (row.status !== 'READY')
        throw new ConflictException('Hints require a ready practice');
      if (row.hintLevel >= 4) return presentPractice(row);
      const saved = await this.prisma.vocabularyPractice.updateMany({
        where: { id, userId, status: 'READY', hintLevel: row.hintLevel },
        data: { hintLevel: { increment: 1 } },
      });
      if (saved.count) return this.get(userId, id);
    }
    throw new ConflictException('Practice changed; reload and retry');
  }

  async answer(userId: string, id: string, input: VocabularyAnswerDto) {
    if (
      typeof input.sentence !== 'string' ||
      !input.sentence.trim() ||
      input.sentence.length > 300 ||
      !isUUID(input.requestKey)
    )
      throw new BadRequestException(
        'A sentence of up to 300 characters and a UUID requestKey are required',
      );
    const row = await this.owned(userId, id);
    if (row.answer !== null) {
      if (row.requestKey !== input.requestKey || row.answer !== input.sentence)
        throw new ConflictException('The first answer is immutable');
      return presentPractice(row);
    }
    if (row.status !== 'READY')
      throw new ConflictException('Practice is not ready');
    const saved = await this.prisma.vocabularyPractice.updateMany({
      where: { id, userId, status: 'READY', answer: null },
      data: {
        answer: input.sentence,
        requestKey: input.requestKey,
        status: 'ASSESSING',
        attempts: 0,
        lockedAt: null,
        availableAt: new Date(),
        errorCode: null,
      },
    });
    if (!saved.count) {
      const winner = await this.owned(userId, id);
      if (
        winner.answer !== input.sentence ||
        winner.requestKey !== input.requestKey
      )
        throw new ConflictException('The first answer is immutable');
      return presentPractice(winner);
    }
    return this.get(userId, id);
  }

  async retry(userId: string, id: string) {
    const owned = await this.owned(userId, id);
    return this.prisma.$transaction(async (tx) => {
      const learning = await lockLearning(tx, userId, owned.vocabularyId);
      const row = await tx.vocabularyPractice.findUniqueOrThrow({
        where: { id },
        include: practiceInclude,
      });
      if (row.status !== 'FAILED')
        throw new ConflictException('Only failed practices can be retried');
      if (row.attempts >= MAX_ATTEMPTS)
        throw new ConflictException('Retry limit reached');
      if (
        row.learningRevision !== learning.manualRevision ||
        !isEnabled(learning)
      )
        throw new ConflictException('Learning changed; start a new practice');
      const active = await tx.vocabularyPractice.findFirst({
        where: { learningId: learning.id, status: { in: OPEN_STATUSES } },
      });
      if (active) throw new ConflictException('Another practice is active');
      return presentPractice(
        await tx.vocabularyPractice.update({
          where: { id },
          data: {
            status: row.answer === null ? 'QUEUED' : 'ASSESSING',
            lockedAt: null,
            availableAt: new Date(),
            errorCode: null,
          },
          include: practiceInclude,
        }),
      );
    });
  }
}
