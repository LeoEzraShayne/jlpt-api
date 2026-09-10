import { NotFoundException } from '@nestjs/common';
import { SessionMode, SessionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { lockStudySession, lockStudyUser } from './study-session-ledger';

export async function revealStudyHint(
  prisma: PrismaService,
  userId: string,
  id: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockStudyUser(tx, userId);
    await lockStudySession(tx, id);
    const session = await tx.studySession.findUnique({ where: { id } });
    if (!session || session.userId !== userId)
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Study session not found',
      });
    if (session.status !== SessionStatus.ACTIVE) return session;
    return tx.studySession.update({
      where: { id },
      data: {
        revealedAt: session.revealedAt ?? new Date(),
        hintRevealCount:
          session.mode !== SessionMode.LEARN ? { increment: 1 } : undefined,
      },
    });
  });
}
