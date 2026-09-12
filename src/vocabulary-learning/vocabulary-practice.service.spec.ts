import { contains, excludes } from './vocabulary-test-fixtures';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import type { PracticeRecord } from './vocabulary-practice.presenter';
import { VocabularyPracticeService } from './vocabulary-practice.service';
import { makePractice } from './vocabulary-test-fixtures';

const requestKey = '10203040-5060-4070-8080-102030405060';
type PracticeMutation = {
  where: { status: string; hintLevel?: number; answer?: null };
  data: Partial<Omit<PracticeRecord, 'hintLevel'>> & {
    hintLevel?: { increment: number };
  };
};
function setup() {
  let row = makePractice();
  const practice = {
    findFirst: jest.fn((args: { where: { userId?: string } }) =>
      Promise.resolve(
        args.where.userId && args.where.userId !== row.userId
          ? null
          : { ...row },
      ),
    ),
    findUniqueOrThrow: jest.fn(() => Promise.resolve({ ...row })),
    updateMany: jest.fn(({ where, data }: PracticeMutation) => {
      if (
        where.status !== row.status ||
        (where.hintLevel !== undefined && where.hintLevel !== row.hintLevel) ||
        (where.answer === null && row.answer !== null)
      )
        return Promise.resolve({ count: 0 });
      const { hintLevel, ...patch } = data;
      row = {
        ...row,
        ...patch,
        ...(hintLevel
          ? { hintLevel: row.hintLevel + hintLevel.increment }
          : {}),
      };
      return Promise.resolve({ count: 1 });
    }),
    update: jest.fn(({ data }: { data: Partial<PracticeRecord> }) => {
      row = { ...row, ...data };
      return Promise.resolve(row);
    }),
    create: jest.fn(({ data }: { data: Partial<PracticeRecord> }) => {
      row = { ...row, ...data, status: 'QUEUED' };
      return Promise.resolve(row);
    }),
  };
  const db = {
    vocabularyPractice: practice,
    vocabularyEntry: {
      findFirst: jest.fn((): Promise<PracticeRecord['vocabulary'] | null> =>
        Promise.resolve(row.vocabulary),
      ),
    },
    vocabularyLearning: {
      findUnique: jest.fn(() => Promise.resolve(row.learning)),
      findFirst: jest.fn((): Promise<PracticeRecord['learning'] | null> =>
        Promise.resolve(row.learning),
      ),
    },
    grammarPoint: {
      findFirst: jest.fn(() => Promise.resolve({ id: 'grammar' })),
    },
    studySession: {
      findFirst: jest.fn(() => Promise.resolve({ grammarId: 'grammar' })),
    },
    $queryRaw: jest.fn(() => Promise.resolve([])),
    $transaction: jest.fn(),
  };
  db.$transaction.mockImplementation(
    (callback: (tx: typeof db) => Promise<unknown>) => callback(db),
  );
  return {
    service: new VocabularyPracticeService(db as unknown as PrismaService),
    db,
    practice,
    get row() {
      return row;
    },
    set row(next) {
      row = next;
    },
  };
}

describe('practice API state transitions', () => {
  it('resumes the unique unfinished practice and locks learning before looking it up', async () => {
    const { service, db, practice } = setup();
    expect(
      await service.start('owner', { vocabularyId: 'sense-arrival' }),
    ).toHaveProperty('id', 'practice');
    expect(practice.create).not.toHaveBeenCalled();
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      practice.findFirst.mock.invocationCallOrder[0],
    );
  });
  it('new practice captures the current manual revision and unknown exposure', async () => {
    const fixture = setup();
    fixture.row.learning.knowledge = 'UNKNOWN';
    fixture.row.learning.practiceEnabled = false;
    fixture.practice.findFirst.mockResolvedValueOnce(null);
    await fixture.service.start('owner', { vocabularyId: 'sense-arrival' });
    expect(fixture.practice.create).toHaveBeenCalledWith(
      contains({
        data: contains({
          learningRevision: 1,
          unknownAtStart: true,
          userId: 'owner',
          vocabularyId: 'sense-arrival',
        }),
      }),
    );
  });
  it('due selection only considers visible enabled unpaused personal learning', async () => {
    const { service, db } = setup();
    db.vocabularyLearning.findFirst.mockResolvedValueOnce(null);
    await expect(service.start('owner', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(db.vocabularyLearning.findFirst).toHaveBeenCalledWith(
      contains({
        where: contains({
          userId: 'owner',
          paused: false,
          vocabulary: {
            validationStatus: 'VALIDATED',
            OR: [{ ownerId: null }, { ownerId: 'owner' }],
          },
        }),
      }),
    );
  });
  it('rejects private, disabled, or missing vocabulary before creating a job', async () => {
    const { service, db, practice } = setup();
    db.vocabularyEntry.findFirst.mockResolvedValueOnce(null);
    await expect(
      service.start('owner', { vocabularyId: 'private' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(practice.create).not.toHaveBeenCalled();
  });
  it('validates session ownership/current status and rejects mismatched grammar', async () => {
    const { service, db } = setup();
    await expect(
      service.start('owner', {
        vocabularyId: 'sense-arrival',
        studySessionId: 'session',
        grammarId: 'different',
      }),
    ).rejects.toThrow('Grammar does not match');
    expect(db.studySession.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session',
        userId: 'owner',
        status: 'ACTIVE',
        grammar: { status: 'PUBLISHED' },
      },
    });
  });
  it('uses an owner and visibility filter on reads', async () => {
    const { service, practice } = setup();
    await expect(service.get('stranger', 'practice')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(practice.findFirst).toHaveBeenCalledWith(
      contains({
        where: contains({
          id: 'practice',
          userId: 'stranger',
          vocabulary: contains({
            validationStatus: 'VALIDATED',
          }),
        }),
      }),
    );
  });
  it('concurrent hint requests are monotonic and clamp at four', async () => {
    const fixture = setup();
    await Promise.all(
      Array.from({ length: 6 }, () =>
        fixture.service.hint('owner', 'practice'),
      ),
    );
    expect(fixture.row.hintLevel).toBe(4);
    expect(await fixture.service.get('owner', 'practice')).toHaveProperty(
      'hintLevel',
      4,
    );
  });
  it('rejects hints after ASSESSING wins an answer/hint race', async () => {
    const fixture = setup();
    await fixture.service.answer('owner', 'practice', {
      sentence: '駅に着く。',
      requestKey,
    });
    await expect(
      fixture.service.hint('owner', 'practice'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(fixture.row.hintLevel).toBe(0);
  });
  it('an already persisted hint stays part of the answer evidence', async () => {
    const fixture = setup();
    await fixture.service.hint('owner', 'practice');
    await fixture.service.answer('owner', 'practice', {
      sentence: '駅に着く。',
      requestKey,
    });
    expect(fixture.row.hintLevel).toBe(1);
    expect(fixture.row.status).toBe('ASSESSING');
  });
  it('concurrent exact answer replay writes once and returns the same immutable answer', async () => {
    const fixture = setup();
    const body = { sentence: '駅に着く。', requestKey };
    const [first, replay] = await Promise.all([
      fixture.service.answer('owner', 'practice', body),
      fixture.service.answer('owner', 'practice', body),
    ]);
    expect(replay).toEqual(first);
    expect(first).toHaveProperty('answer', body.sentence);
    expect(fixture.row.answer).toBe(body.sentence);
  });
  it.each([
    { sentence: 'changed', requestKey },
    {
      sentence: 'original',
      requestKey: '20203040-5060-4070-8080-102030405060',
    },
  ])('rejects changed replay %j', async (replay) => {
    const fixture = setup();
    await fixture.service.answer('owner', 'practice', {
      sentence: 'original',
      requestKey,
    });
    await expect(
      fixture.service.answer('owner', 'practice', replay),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('validates blank, oversized answers and invalid idempotency keys in service too', async () => {
    const { service } = setup();
    for (const body of [
      { sentence: ' ', requestKey },
      { sentence: 'a'.repeat(301), requestKey },
      { sentence: 'abc', requestKey: 'no' },
    ])
      await expect(service.answer('owner', 'practice', body)).rejects.toThrow(
        '300',
      );
  });
  it.each([null, 'immutable answer'])(
    'retry preserves answer/hints/attempts and selects the correct phase: %s',
    async (answer) => {
      const fixture = setup();
      fixture.row = makePractice({
        status: 'FAILED',
        answer,
        hintLevel: 3,
        attempts: 1,
        requestKey: answer ? requestKey : null,
      });
      fixture.practice.findFirst
        .mockResolvedValueOnce(fixture.row)
        .mockResolvedValueOnce(null);
      const result = await fixture.service.retry('owner', 'practice');
      expect(result.status).toBe(answer ? 'ASSESSING' : 'QUEUED');
      expect(fixture.row).toMatchObject({ answer, hintLevel: 3, attempts: 1 });
      expect(fixture.practice.update).toHaveBeenCalledWith(
        contains({
          data: excludes({ answer: expect.anything() as unknown }),
        }),
      );
    },
  );
  it.each([{ attempts: 3 }, { learningRevision: 0 }])(
    'rejects exhausted or stale retry: %j',
    async (changes) => {
      const fixture = setup();
      fixture.row = makePractice({ status: 'FAILED', ...changes });
      await expect(
        fixture.service.retry('owner', 'practice'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(fixture.practice.update).not.toHaveBeenCalled();
    },
  );
  it('will not resurrect a failed job over a newer active one', async () => {
    const fixture = setup();
    fixture.row = makePractice({ status: 'FAILED' });
    await expect(fixture.service.retry('owner', 'practice')).rejects.toThrow(
      'Another practice',
    );
  });
});
