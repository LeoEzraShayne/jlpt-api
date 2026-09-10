import { nextCalendarDate } from '../study-plans/study-plan-dates';
import { JlptLevel, Prisma } from '@prisma/client';
import { localDateKey } from '../review/adaptive-review';

/** Shared server gate: only scheduled mandatory reviews in the learner's group. */
export async function countRequiredReviewsForGroup(
  tx: Prisma.TransactionClient,
  userId: string,
  timezone: string,
  grammarLevel: JlptLevel,
) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const taskDate = new Date(`${localDateKey(timezone)}T00:00:00.000Z`);
  return tx.studyTask.count({
    where: {
      userId,
      taskDate,
      type: 'REVIEW',
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      plan: { status: 'ACTIVE', startDate: { lt: nextCalendarDate(taskDate) } },
      grammar: {
        level:
          grammarLevel === user.targetLevel
            ? user.targetLevel
            : { not: user.targetLevel },
      },
    },
  });
}
