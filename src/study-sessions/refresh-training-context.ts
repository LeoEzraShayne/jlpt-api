import type { PrismaService } from '../database/prisma.service';
import type { SceneService } from '../scenes/scenes.service';
import { PRACTICE_SELECTION_VERSION } from '../scenes/grammar-practice-catalog';
import { lockStudySession, lockStudyUser } from './study-session-ledger';

export function needsTrainingRefresh(session: {
  status: string;
  trainingContext: unknown;
  attempts: unknown[];
}) {
  return (
    session.status === 'ACTIVE' &&
    session.attempts.length === 0 &&
    (session.trainingContext as { selectionVersion?: string } | null)
      ?.selectionVersion !== PRACTICE_SELECTION_VERSION
  );
}
// Old, unsubmitted sessions can receive relevant tasks. Never rewrite graded attempts/history.
export async function refreshTrainingContext(
  prisma: PrismaService,
  scenes: SceneService,
  userId: string,
  id: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockStudyUser(tx, userId);
    await lockStudySession(tx, id);
    const session = await tx.studySession.findFirst({
      where: { id, userId },
      include: { grammar: true, attempts: { select: { id: true } } },
    });
    if (!session) return null;
    const { grammar, attempts, ...current } = session;
    // Another device may have refreshed or submitted while this request waited.
    // Return the locked current row instead of the caller's stale initial snapshot.
    if (!needsTrainingRefresh({ ...current, attempts })) return current;
    const training = await scenes.assign(tx, userId, id, grammar);
    const updated = await tx.studySession.update({
      where: { id },
      data: training,
    });
    return updated;
  });
}
