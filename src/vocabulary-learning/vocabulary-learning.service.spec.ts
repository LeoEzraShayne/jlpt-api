import type { PrismaService } from '../database/prisma.service';
import { VocabularyLearningService } from './vocabulary-learning.service';
import { makeLearning, makePractice } from './vocabulary-test-fixtures';

function setup() {
  const learning = makeLearning();
  const vocabulary = makePractice().vocabulary;
  const db = {
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(),
    vocabularyEntry: { findFirst: jest.fn(async () => vocabulary) },
    vocabularyLearning: {
      upsert: jest.fn(async () => learning),
      findUnique: jest.fn(async () => learning),
      findMany: jest.fn(async () => [{ ...learning, vocabulary }]),
      count: jest.fn(async () => 1),
      update: jest.fn(async ({ data }: any) => ({
        ...learning,
        ...data,
        manualRevision: learning.manualRevision + 1,
      })),
    },
    vocabularyPractice: {
      updateMany: jest.fn(async () => ({ count: 1 })),
      findMany: jest.fn(async () => [makePractice({ status: 'COMPLETED' })]),
      count: jest.fn(async () => 2),
    },
    user: { findUnique: jest.fn(async () => ({ timezone: 'Asia/Tokyo' })) },
  };
  db.$transaction.mockImplementation(async (value: any) =>
    Array.isArray(value) ? Promise.all(value) : value(db),
  );
  return {
    db,
    learning,
    service: new VocabularyLearningService(db as unknown as PrismaService),
  };
}

describe('learning service query and mutation boundaries', () => {
  it('a changed manual revision revokes active practices without deleting evidence', async () => {
    const { service, db } = setup();
    const result = await service.setLearning(
      'owner',
      'sense-arrival',
      'REMEMBERED',
    );
    expect(result).toMatchObject({
      manualRevision: 2,
      knowledge: 'REMEMBERED',
      practiceEnabled: true,
    });
    expect(db.vocabularyPractice.updateMany).toHaveBeenCalledWith({
      where: {
        learningId: 'learning',
        status: { in: ['QUEUED', 'GENERATING', 'READY', 'ASSESSING'] },
      },
      data: { status: 'FAILED', lockedAt: null, errorCode: 'LEARNING_CHANGED' },
    });
    expect(db.vocabularyLearning.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ memoryCard: expect.anything() }),
      }),
    );
  });
  it('a no-op manual action does not revoke or increment the revision', async () => {
    const { service, db, learning } = setup();
    learning.knowledge = 'REMEMBERED';
    await service.setLearning('owner', 'sense-arrival', 'REMEMBERED');
    expect(db.vocabularyLearning.update).not.toHaveBeenCalled();
    expect(db.vocabularyPractice.updateMany).not.toHaveBeenCalled();
  });
  it('list cursor uses per-sense vocabulary IDs consistently with ordering', async () => {
    const { service, db } = setup();
    const first = { ...makeLearning(), vocabulary: makePractice().vocabulary };
    db.vocabularyLearning.findMany.mockResolvedValueOnce([
      first,
      { ...first, vocabularyId: 'next-sense' },
    ]);
    const result = await service.list('owner', {
      list: 'UNKNOWN',
      cursor: 'previous-sense',
      level: 'N1',
      query: 'word',
      limit: 1,
    });
    expect(result.meta.nextCursor).toBe('sense-arrival');
    expect(result.data[0]).toHaveProperty(
      'learning.vocabularyId',
      'sense-arrival',
    );
    expect(db.vocabularyLearning.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'owner',
          knowledge: 'UNKNOWN',
          vocabularyId: { gt: 'previous-sense' },
          vocabulary: expect.objectContaining({
            level: 'N1',
            validationStatus: 'VALIDATED',
            OR: [{ ownerId: null }, { ownerId: 'owner' }],
            AND: expect.any(Array),
          }),
        }),
        orderBy: { vocabularyId: 'asc' },
        take: 2,
      }),
    );
  });
  it.each([
    ['PRACTICE', { practiceEnabled: true }],
    ['REMEMBERED', { knowledge: 'REMEMBERED' }],
    [
      'DUE',
      {
        paused: false,
        OR: [{ knowledge: 'UNKNOWN' }, { practiceEnabled: true }],
      },
    ],
  ] as const)(
    '%s filters only explicitly marked personal records',
    async (list, filter) => {
      const { service, db } = setup();
      await service.list('owner', { list });
      expect(db.vocabularyLearning.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining(filter) }),
      );
      expect(db.vocabularyLearning.upsert).not.toHaveBeenCalled();
    },
  );
  it('the integration enrichment helper is scoped and never imports bookmarks', async () => {
    const { service, db } = setup();
    const byId = await service.learningByVocabularyIds('owner', [
      'sense-arrival',
    ]);
    expect(byId.get('sense-arrival')).not.toHaveProperty('memoryCard');
    expect(db.vocabularyLearning.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'owner',
        vocabularyId: { in: ['sense-arrival'] },
        vocabulary: {
          validationStatus: 'VALIDATED',
          OR: [{ ownerId: null }, { ownerId: 'owner' }],
        },
      },
    });
    expect(db.vocabularyLearning.upsert).not.toHaveBeenCalled();
  });
  it('history is completed-only, owner/sense scoped, and cursor bounded', async () => {
    const { service, db } = setup();
    await service.history('owner', 'sense-arrival', {
      cursor: 'older-than',
      limit: 2,
    });
    expect(db.vocabularyPractice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'owner',
          vocabularyId: 'sense-arrival',
          status: 'COMPLETED',
          id: { lt: 'older-than' },
        },
        take: 3,
        orderBy: { id: 'desc' },
      }),
    );
  });
  it('summary excludes paused due items and uses the user local day for completion', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-12T16:00:00Z'));
    try {
      const { service, db } = setup();
      expect(await service.summary('owner')).toEqual({
        unknownCount: 1,
        practiceCount: 1,
        rememberedCount: 1,
        dueCount: 1,
        completedTodayCount: 2,
      });
      expect(db.vocabularyLearning.count).toHaveBeenLastCalledWith({
        where: expect.objectContaining({ userId: 'owner', paused: false }),
      });
      expect(db.vocabularyPractice.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          userId: 'owner',
          status: 'COMPLETED',
          completedAt: {
            gte: new Date('2026-09-12T15:00:00Z'),
            lt: new Date('2026-09-13T15:00:00Z'),
          },
        }),
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
