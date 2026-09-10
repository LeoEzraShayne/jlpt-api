import { Prisma, type StudySession } from '@prisma/client';
import { localDateKey } from '../review/adaptive-review';

/** Split a bounded heartbeat window, including DST, at the user's local midnight. */
export function splitActivityDays(
  from: Date | null,
  now: Date,
  timezone: string,
  creditedThrough?: Date | null,
) {
  if (!from) return [];
  const start = Math.max(
    from.getTime(),
    now.getTime() - 90_000,
    creditedThrough?.getTime() ?? 0,
  );
  const seconds = Math.max(0, Math.floor((now.getTime() - start) / 1_000));
  const days = new Map<string, number>();
  for (let offset = 0; offset < seconds; offset++) {
    // Credit the second ending at this instant to the day containing its beginning.
    const day = localDateKey(
      timezone,
      new Date(now.getTime() - (offset + 1) * 1_000),
    );
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return [...days]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, activeSeconds]) => ({
      studyDate: new Date(`${date}T00:00:00.000Z`),
      activeSeconds,
    }));
}

/** Caller must hold the user lock and then the session lock. */
export async function creditStudyActivity(
  tx: Prisma.TransactionClient,
  session: StudySession,
  timezone: string,
  now: Date,
) {
  // A user's overlapping sessions/devices share one elapsed-time cursor. Only sessions
  // with credited ledger rows participate; opening a new session cannot consume time.
  const [cursor] = await tx.$queryRaw<
    { creditedThrough: Date | null }[]
  >(Prisma.sql`
    SELECT max(s."lastActivityAt") AS "creditedThrough" FROM "StudySession" s
    WHERE s."userId" = ${session.userId} AND EXISTS (
      SELECT 1 FROM "StudyActivityDay" d WHERE d."sessionId" = s.id AND d."activeSeconds" > 0
    )`);
  const days = splitActivityDays(
    session.lastActivityAt,
    now,
    timezone,
    cursor?.creditedThrough,
  );
  for (const day of days) {
    const previous = await tx.studyActivityDay.aggregate({
      where: { userId: session.userId, studyDate: day.studyDate },
      _sum: { activeSeconds: true },
    });
    const before = previous._sum.activeSeconds ?? 0;
    const minuteDelta =
      Math.ceil((before + day.activeSeconds) / 60) - Math.ceil(before / 60);
    await tx.studyActivityDay.upsert({
      where: {
        sessionId_studyDate: {
          sessionId: session.id,
          studyDate: day.studyDate,
        },
      },
      create: { sessionId: session.id, userId: session.userId, ...day },
      update: { activeSeconds: { increment: day.activeSeconds } },
    });
    await tx.dailyStudyStat.upsert({
      where: {
        userId_studyDate: { userId: session.userId, studyDate: day.studyDate },
      },
      create: {
        userId: session.userId,
        studyDate: day.studyDate,
        studyMinutes: minuteDelta,
      },
      update: { studyMinutes: { increment: minuteDelta } },
    });
  }
  const credited = days.reduce((sum, day) => sum + day.activeSeconds, 0);
  const updated = await tx.studySession.update({
    where: { id: session.id },
    data: { activeSeconds: { increment: credited }, lastActivityAt: now },
  });
  return { updated, credited };
}

export async function lockStudyUser(
  tx: Prisma.TransactionClient,
  userId: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`,
  );
}

export async function lockStudySession(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "StudySession" WHERE id = ${id} FOR UPDATE`,
  );
}
