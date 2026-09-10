import { NotFoundException } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import {
  creditStudyActivity,
  lockStudySession,
  lockStudyUser,
} from './study-session-ledger';

export async function recordStudyActivity(
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
    if (session.status !== SessionStatus.ACTIVE)
      return { activeSeconds: session.activeSeconds, accepted: false };
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { timezone: true },
    });
    const { updated, credited } = await creditStudyActivity(
      tx,
      session,
      user.timezone,
      new Date(),
    );
    return { activeSeconds: updated.activeSeconds, accepted: credited > 0 };
  });
}
