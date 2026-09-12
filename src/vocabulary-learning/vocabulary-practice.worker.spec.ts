import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../database/prisma.service';
import type { VocabularyAiService } from './vocabulary-ai.service';
import { VocabularyPracticeWorker } from './vocabulary-practice.worker';
import {
  claimVocabularyPractice,
  vocabularyLeaseWhere,
} from './vocabulary-practice.lease';
import {
  assessment,
  challenge,
  makePractice,
  now,
} from './vocabulary-test-fixtures';

function setup(answer: string | null = null) {
  const lease = {
    id: 'practice',
    status: answer ? 'ASSESSING' : 'GENERATING',
    lockedAt: now,
    attempts: 1,
  };
  const row = makePractice({ answer, ...lease });
  let inTransaction = false;
  const db = {
    $executeRaw: jest.fn(async () => 0),
    $queryRaw: jest.fn(async () => [lease]),
    $transaction: jest.fn(),
    vocabularyPractice: {
      findFirst: jest.fn(async () => (inTransaction ? null : row)),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    vocabularyEntry: {
      findFirst: jest.fn(async () => ({ id: row.vocabularyId })),
    },
    vocabularyLearning: {
      findUnique: jest.fn(async () => row.learning),
      update: jest.fn(),
    },
    userGrammarProgress: { findMany: jest.fn(async () => []) },
    user: {
      findUniqueOrThrow: jest.fn(async () => ({ timezone: 'Asia/Tokyo' })),
    },
  };
  db.$transaction.mockImplementation(
    async (callback: (tx: typeof db) => unknown) => {
      inTransaction = true;
      try {
        return await callback(db);
      } finally {
        inTransaction = false;
      }
    },
  );
  const ai = {
    generate: jest.fn(async () => {
      expect(inTransaction).toBe(false);
      return challenge;
    }),
    assess: jest.fn(async () => {
      expect(inTransaction).toBe(false);
      return assessment;
    }),
  };
  const config = { get: jest.fn((): boolean | string => true) };
  return {
    lease,
    row,
    db,
    ai,
    config,
    worker: new VocabularyPracticeWorker(
      db as unknown as PrismaService,
      ai as unknown as VocabularyAiService,
      config as unknown as ConfigService,
    ),
  };
}

describe('durable vocabulary worker', () => {
  it.each([false, 'false', undefined])(
    'timer is disabled for %s',
    async (enabled) => {
      const fixture = setup();
      fixture.config.get.mockReturnValue(enabled as any);
      await fixture.worker.poll();
      expect(fixture.db.$queryRaw).not.toHaveBeenCalled();
      expect(fixture.ai.generate).not.toHaveBeenCalled();
    },
  );
  it('processOne explicitly drives one job for the integration harness', async () => {
    const { worker, ai, db, lease } = setup();
    await worker.processOne();
    expect(ai.generate).toHaveBeenCalledTimes(1);
    expect(db.vocabularyPractice.updateMany).toHaveBeenCalledWith({
      where: vocabularyLeaseWhere(lease),
      data: expect.objectContaining({
        status: 'READY',
        grammarId: null,
        attempts: 0,
        lockedAt: null,
        challenge: expect.objectContaining({ _input: expect.anything() }),
      }),
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('overlapping poll calls cannot claim additional work while AI runs', async () => {
    const { worker, ai, db } = setup();
    let finish!: (value: typeof challenge) => void;
    ai.generate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = worker.processOne();
    while (!finish) await Promise.resolve();
    await worker.processOne();
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    finish(challenge);
    await pending;
  });
  it('provider failure writes only a fenced failure, never successful evidence', async () => {
    const { worker, ai, db, lease } = setup('saved answer');
    ai.assess.mockRejectedValueOnce(new Error('private raw provider payload'));
    await worker.processOne();
    expect(db.vocabularyPractice.updateMany).toHaveBeenCalledWith({
      where: vocabularyLeaseWhere(lease),
      data: { status: 'FAILED', lockedAt: null, errorCode: 'AI_FAILED' },
    });
    expect(db.vocabularyLearning.update).not.toHaveBeenCalled();
    expect(
      JSON.stringify(db.vocabularyPractice.updateMany.mock.calls),
    ).not.toContain('private');
  });
  it('a lost lease never commits FSRS even if AI completed successfully', async () => {
    const { worker, db } = setup('saved answer');
    db.vocabularyPractice.updateMany.mockResolvedValueOnce({ count: 0 });
    await worker.processOne();
    expect(db.vocabularyLearning.update).not.toHaveBeenCalled();
  });
  it('uses the frozen challenge input rather than changed live vocabulary for grading', async () => {
    const { worker, row, ai } = setup('saved answer');
    row.vocabulary.senseKey = 'new sense';
    row.vocabulary.word = 'new spelling';
    await worker.processOne();
    expect(ai.assess).toHaveBeenCalledWith(
      expect.objectContaining({ word: '着く', senseKey: 'arrival' }),
      expect.objectContaining({ promptZh: challenge.promptZh }),
      'saved answer',
    );
  });
  it('rejects AI choosing a grammar outside the bounded candidate list', async () => {
    const { worker, ai, db } = setup();
    ai.generate.mockResolvedValueOnce({
      ...challenge,
      grammarId: 'unauthorized',
    } as any);
    await worker.processOne();
    expect(db.vocabularyPractice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED' }),
      }),
    );
  });
  it('invisible vocabulary is revoked before any provider call', async () => {
    const { worker, ai, db } = setup();
    db.vocabularyEntry.findFirst.mockResolvedValueOnce(null as any);
    await worker.processOne();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(db.vocabularyPractice.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorCode: 'LEARNING_CHANGED' }),
      }),
    );
  });
});

describe('lease recovery SQL', () => {
  it('claims with UTC, skip-locked, bounded attempts and exact timestamp/attempt fencing', async () => {
    const { db, lease } = setup();
    expect(
      await claimVocabularyPractice(db as unknown as PrismaService),
    ).toEqual(lease);
    const sql = (db.$queryRaw.mock.calls as any)[0][0].sql as string;
    expect(sql).toContain("AT TIME ZONE 'UTC'");
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("interval '2 minutes'");
    expect(sql).toContain("interval '1 minute'");
    expect(sql).toContain('attempts=attempts+1');
    expect(vocabularyLeaseWhere(lease)).toEqual(lease);
    const expired = (db.$executeRaw.mock.calls as any)[0][0].sql as string;
    expect(expired).toContain("'RETRY_LIMIT'");
    expect(expired).toContain('attempts >=');
  });
});
