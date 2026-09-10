import { NotFoundException } from '@nestjs/common';
import { StudySessionsService } from '../study-sessions/study-sessions.service';

const trainingContext = {
  version: 'training-v1',
  instructionZh: '换场景练习',
  scenario: null,
  words: [],
  supportingGrammar: null,
  expressions: [
    {
      id: 'e1',
      sentence: '秘密の例文',
      furigana: null,
      translationZh: '隐藏中文',
      provenance: {},
    },
  ],
  phrases: [],
};
const now = new Date();
const session = {
  id: 's1',
  userId: 'u1',
  grammarId: 'g1',
  mode: 'REVIEW',
  status: 'ACTIVE',
  revealedAt: null,
  hintRevealCount: 0,
  trainingContext,
  timerPhase: 'FOCUS',
  timerPhaseStartedAt: now,
  timerPhaseEndsAt: new Date(now.getTime() + 600000),
};

function mockPrisma() {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    studySession: {
      findUnique: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(() => {
        events.push('hint-written');
        return Promise.resolve({
          ...session,
          hintRevealCount: 1,
          revealedAt: now,
        });
      }),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn(async (work: (tx: object) => Promise<unknown>) => {
      const result = await work(tx);
      events.push('hint-committed');
      return result;
    }),
    grammarPoint: {
      findUnique: jest.fn().mockImplementation(() => {
        events.push('reference-read');
        return Promise.resolve({
          id: 'g1',
          examples: [{ sentence: '学習例文' }],
        });
      }),
    },
  };
  return { prisma, events };
}
describe('review reference endpoint boundary', () => {
  it('returns references only after hint transaction commits', async () => {
    const { prisma, events } = mockPrisma();
    const recordShown = jest.fn().mockResolvedValue(undefined);
    const service = new StudySessionsService(prisma as never, undefined, {
      recordShown,
    } as never);
    const revealed = await service.reveal('u1', 's1');
    expect(events).toEqual([
      'hint-written',
      'hint-committed',
      'reference-read',
    ]);
    expect(revealed.hintRevealCount).toBe(1);
    expect(JSON.stringify(revealed)).toContain('秘密');
    expect(recordShown).toHaveBeenCalledWith('u1', 's1', trainingContext, true);
  });
  it('does not read references or record exposure for another account', async () => {
    const { prisma, events } = mockPrisma();
    const recordShown = jest.fn();
    const service = new StudySessionsService(prisma as never, undefined, {
      recordShown,
    } as never);
    await expect(service.reveal('attacker', 's1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(events).toEqual([]);
    expect(recordShown).not.toHaveBeenCalled();
  });
  it('hides generic get references even after a previous reveal', async () => {
    const prisma = {
      studySession: {
        findFirst: jest.fn().mockResolvedValue({
          ...session,
          revealedAt: now,
          grammar: {
            examples: [{ sentence: '秘密' }],
            chineseExplanation: '隐藏中文',
            title: '目标语法',
          },
        }),
      },
    };
    const result = await new StudySessionsService(prisma as never).get(
      'u1',
      's1',
    );
    expect(JSON.stringify(result)).not.toContain('秘密');
    expect(JSON.stringify(result)).not.toContain('隐藏中文');
    expect(result.trainingContext?.referenceHidden).toBe(true);
    expect(prisma.studySession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1', userId: 'u1' } }),
    );
  });
});
