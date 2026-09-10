import { ReviewController } from './review.controller';

function fixture(levels: string[]) {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    studyPlan: {
      findMany: jest.fn().mockResolvedValue(levels.map((level) => ({ level }))),
    },
    reviewSchedule: { findMany },
  };
  return { prisma, controller: new ReviewController(prisma as never) };
}
const request = { currentUser: { id: 'u', timezone: 'Asia/Tokyo' } };

describe('enabled-level review queue', () => {
  it('returns no automatic queue when all plans are paused instead of falling back to all levels', async () => {
    const { controller, prisma } = fixture([]);
    const result = await controller.getQueue(request as never, {
      limit: 50,
      upcomingDays: 7,
    });
    expect(result.data).toEqual([]);
    const query = prisma.reviewSchedule.findMany.mock.calls[0] as unknown as [
      { where: { progress: object } },
    ];
    expect(query[0].where.progress).toEqual({
      userId: 'u',
      grammar: { status: 'PUBLISHED', level: { in: [] } },
    });
  });

  it('limits a level filter to the enabled plans', async () => {
    const { controller, prisma } = fixture(['N1', 'N2']);
    await controller.getQueue(request as never, {
      level: 'N3',
      limit: 50,
      upcomingDays: 7,
    });
    const query = prisma.reviewSchedule.findMany.mock.calls[0] as unknown as [
      { where: { progress: object } },
    ];
    expect(query[0].where.progress).toEqual({
      userId: 'u',
      grammar: { status: 'PUBLISHED', level: { in: [] } },
    });
  });

  it('allows explicit historical all-level browsing without changing automatic plan state', async () => {
    const { controller, prisma } = fixture([]);
    await controller.getQueue(request as never, {
      scope: 'all',
      level: 'N4',
      limit: 50,
      upcomingDays: 7,
    });
    expect(prisma.studyPlan.findMany).not.toHaveBeenCalled();
    const query = prisma.reviewSchedule.findMany.mock.calls[0] as unknown as [
      { where: { progress: object } },
    ];
    expect(query[0].where.progress).toEqual({
      userId: 'u',
      grammar: { status: 'PUBLISHED', level: 'N4' },
    });
  });
});
