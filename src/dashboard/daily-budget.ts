import { Prisma } from '@prisma/client';
import { budgetGroup, BudgetGroup } from './daily-allocation';

export async function loadDailyBudget(
  tx: Prisma.TransactionClient,
  userId: string,
  _timezone: string,
  key: string,
  primary: string,
) {
  const studyDate = new Date(`${key}T00:00:00.000Z`);
  const [ledger, legacyStat, sessions] = await Promise.all([
    tx.studyActivityDay.findMany({
      where: { userId, studyDate },
      include: { session: { include: { grammar: true } } },
    }),
    tx.dailyStudyStat.findUnique({
      where: { userId_studyDate: { userId, studyDate } },
    }),
    tx.studySession.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { grammar: true, task: true },
    }),
  ]);
  const actual: Record<BudgetGroup, number> = { PRIMARY: 0, FOUNDATION: 0 };
  for (const entry of ledger)
    actual[budgetGroup(entry.session.grammar.level, primary)] +=
      entry.activeSeconds / 60;
  // B's heartbeat advances DailyStudyStat by the change in ceil(today ledger / 60).
  // Any surplus is pre-ledger history; never charge lifetime cross-day session time.
  const ledgerSeconds = ledger.reduce(
    (sum, entry) => sum + entry.activeSeconds,
    0,
  );
  const legacyMinutes = Math.max(
    0,
    (legacyStat?.studyMinutes ?? 0) - Math.ceil(ledgerSeconds / 60),
  );
  actual.PRIMARY += legacyMinutes;
  const reserved: Record<BudgetGroup, number> = { PRIMARY: 0, FOUNDATION: 0 };
  for (const session of sessions) {
    const estimate =
      session.task?.estimatedMinutes ?? (session.mode === 'LEARN' ? 8 : 4);
    reserved[budgetGroup(session.grammar.level, primary)] += Math.max(
      0,
      estimate - session.activeSeconds / 60,
    );
  }
  return {
    actual,
    reserved,
    committed: {
      PRIMARY: actual.PRIMARY + reserved.PRIMARY,
      FOUNDATION: actual.FOUNDATION + reserved.FOUNDATION,
    },
  };
}
