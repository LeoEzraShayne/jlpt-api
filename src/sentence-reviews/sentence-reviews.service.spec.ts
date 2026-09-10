import { NotFoundException } from '@nestjs/common';
import { SentenceReviewsService } from './sentence-reviews.service';

const scenario = {
  version: 'scenario-v1',
  id: 'server-scene',
  scenarioId: 'server-scene',
  taskId: 'task',
  objectiveId: 'REQUEST_HELP',
  domain: 'WORK',
  objective: 'REQUEST_HELP',
  register: 'POLITE',
  promptZh: '请求同事帮助',
};
const trainingContext = {
  version: 'training-v1',
  instructionZh: '独立表达',
  scenario,
  words: [],
  supportingGrammar: null,
  expressions: [],
  phrases: [],
};
function client(ownerId = 'u1') {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    studySession: {
      findUnique: jest.fn().mockResolvedValue({
        id: 's1',
        userId: ownerId,
        grammarId: 'g1',
        mode: 'REVIEW',
        status: 'ACTIVE',
        trainingContext,
      }),
    },
    sentenceAttempt: {
      create: jest
        .fn()
        .mockResolvedValue({ aiJob: { id: 'job1', status: 'QUEUED' } }),
    },
  };
  return {
    ...tx,
    $transaction: jest.fn((fn: (db: typeof tx) => unknown) => fn(tx)),
  };
}
describe('server-owned sentence scenario', () => {
  it('ignores client scene as proof and persists the server task under session lock', async () => {
    const prisma = client();
    await new SentenceReviewsService(prisma as never).create('u1', {
      sessionId: 's1',
      sentence: '手伝ってくれませんか。',
      scene: '已经成功跨场景',
    });
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(prisma.sentenceAttempt.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scene: '请求同事帮助',
          studySessionId: 's1',
          userId: 'u1',
        }) as unknown,
      }),
    );
  });
  it('rejects attempts against another account without creating a job', async () => {
    const prisma = client('other');
    await expect(
      new SentenceReviewsService(prisma as never).create('u1', {
        sessionId: 's1',
        sentence: 'はい。',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.sentenceAttempt.create).not.toHaveBeenCalled();
  });
});
