import { Prisma, type StudySession } from '@prisma/client';
import { localDateKey } from '../review/adaptive-review';
import { creditStudyActivity } from './study-session-ledger';

export async function finishEvidenceSession(
  tx: Prisma.TransactionClient,
  session: StudySession,
  timezone: string,
  now: Date,
  hasSentence: boolean,
) {
  await creditStudyActivity(tx, session, timezone, now);
  const completed = await tx.studySession.update({
    where: { id: session.id },
    data: { status: 'COMPLETED', completedAt: now },
  });
  if (session.taskId)
    await tx.studyTask.update({
      where: { id: session.taskId },
      data: { status: 'COMPLETED', completedAt: now },
    });
  const studyDate = new Date(`${localDateKey(timezone, now)}T00:00:00.000Z`);
  await tx.dailyStudyStat.upsert({
    where: { userId_studyDate: { userId: session.userId, studyDate } },
    create: {
      userId: session.userId,
      studyDate,
      tasksCompleted: session.taskId ? 1 : 0,
      sentenceCount: hasSentence ? 1 : 0,
    },
    update: {
      tasksCompleted: session.taskId ? { increment: 1 } : undefined,
      sentenceCount: hasSentence ? { increment: 1 } : undefined,
    },
  });
  return completed;
}
