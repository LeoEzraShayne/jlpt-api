import { StudyPlansService } from './study-plans.service';

function fixture() {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'u',
        targetLevel: 'N1',
        dailyMinutes: 30,
        primaryShare: 80,
      }),
      update: jest.fn(),
    },
    studyPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: object }) =>
          Promise.resolve(data),
        ),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    grammarPoint: { count: jest.fn().mockResolvedValue(20) },
    userGrammarProgress: { count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    ...tx,
    $transaction: jest
      .fn()
      .mockImplementation((callback: (client: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
  };
  return { tx, service: new StudyPlansService(prisma as never) };
}
const dto = {
  level: 'N2' as const,
  startDate: new Date('2099-01-01'),
  targetDate: new Date('2099-12-01'),
  dailyMinutes: 40,
  dailyNewLimit: 2,
};

describe('level-specific current plans', () => {
  it('returns the existing paused plan without replacing it or changing the primary level', async () => {
    const { tx, service } = fixture();
    const paused = { id: 'p', status: 'PAUSED', level: 'N2' };
    tx.studyPlan.findFirst.mockResolvedValue(paused);
    expect(await service.create('u', dto)).toEqual(paused);
    expect(tx.studyPlan.create).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('creates a foundation gap-fill plan without pausing another plan or replacing primary', async () => {
    const { tx, service } = fixture();
    expect(await service.create('u', dto)).toMatchObject({
      level: 'N2',
      mode: 'GAP_FILL',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.studyPlan.update).not.toHaveBeenCalled();
  });

  it('persists UI noon dates at midnight when creating a plan starting today', async () => {
    const { tx, service } = fixture();
    const today = new Date().toISOString().slice(0, 10);
    await service.create('u', {
      ...dto,
      startDate: new Date(`${today}T12:00:00.000Z`),
      targetDate: new Date('2099-12-01T12:00:00.000Z'),
    });
    expect(tx.studyPlan.create).toHaveBeenCalledWith({
      data: {
        ...dto,
        userId: 'u',
        mode: 'GAP_FILL',
        startDate: new Date(`${today}T00:00:00.000Z`),
        targetDate: new Date('2099-12-01T00:00:00.000Z'),
      },
    });
  });

  it('persists edited UI noon dates at midnight without changing their calendar day', async () => {
    const { tx, service } = fixture();
    const today = new Date().toISOString().slice(0, 10);
    tx.studyPlan.findFirst.mockResolvedValue({ id: 'p', ...dto });
    await service.updateById('u', 'p', {
      startDate: new Date(`${today}T12:00:00.000Z`),
      targetDate: new Date('2099-12-01T12:00:00.000Z'),
    });
    expect(tx.studyPlan.update).toHaveBeenCalledWith({
      where: { id: 'p' },
      data: {
        startDate: new Date(`${today}T00:00:00.000Z`),
        targetDate: new Date('2099-12-01T00:00:00.000Z'),
      },
    });
  });

  it('rejects resume of an archived plan when that level already has a current plan', async () => {
    const { tx, service } = fixture();
    tx.studyPlan.findFirst
      .mockResolvedValueOnce({
        id: 'old',
        level: 'N1',
        status: 'ARCHIVED',
        startDate: dto.startDate,
        targetDate: dto.targetDate,
      })
      .mockResolvedValueOnce({ id: 'current' });
    await expect(
      service.updateById('u', 'old', { status: 'ACTIVE' }),
    ).rejects.toMatchObject({ response: { code: 'CURRENT_PLAN_EXISTS' } });
    expect(tx.studyPlan.update).not.toHaveBeenCalled();
  });

  it('current compatibility only queries the explicit primary level', async () => {
    const { tx, service } = fixture();
    await expect(service.getCurrent('u')).rejects.toMatchObject({
      response: { code: 'PLAN_NOT_INITIALIZED' },
    });
    expect(tx.studyPlan.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u', level: 'N1', status: { in: ['ACTIVE', 'PAUSED'] } },
    });
  });

  it('guards id access by user and exposes the frozen list envelope payload', async () => {
    const { tx, service } = fixture();
    await expect(service.getById('u', 'other-user-plan')).rejects.toMatchObject(
      { response: { code: 'PLAN_NOT_FOUND' } },
    );
    expect(tx.studyPlan.findFirst).toHaveBeenCalledWith({
      where: { id: 'other-user-plan', userId: 'u' },
    });
    expect(await service.list('u')).toEqual({ items: [], nextCursor: null });
  });
});
