import { nextCalendarDate } from '../study-plans/study-plan-dates';
import { localDateKey } from '../review/adaptive-review';
import { countRequiredReviewsForGroup } from './required-reviews';

describe('group-only server new-learning gate', () => {
  it.each(['N1', 'N2'] as const)(
    'checks only the scheduled reviews in the group for %s',
    async (level) => {
      const count = jest.fn().mockResolvedValue(0);
      const tx = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue({ targetLevel: 'N1' }),
        },
        studyTask: { count },
      };
      expect(
        await countRequiredReviewsForGroup(
          tx as never,
          'u',
          'Asia/Tokyo',
          level,
        ),
      ).toBe(0);
      expect(count).toHaveBeenCalledWith({
        where: {
          userId: 'u',
          taskDate: new Date(`${localDateKey('Asia/Tokyo')}T00:00:00.000Z`),
          type: 'REVIEW',
          status: { in: ['PENDING', 'IN_PROGRESS'] },
          plan: {
            status: 'ACTIVE',
            startDate: {
              lt: nextCalendarDate(
                new Date(`${localDateKey('Asia/Tokyo')}T00:00:00.000Z`),
              ),
            },
          },
          grammar: { level: level === 'N1' ? 'N1' : { not: 'N1' } },
        },
      });
    },
  );
});
