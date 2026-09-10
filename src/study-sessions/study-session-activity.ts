import { NotFoundException } from '@nestjs/common';
import { SessionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { accountableActivitySeconds } from './study-session-outcome';

export async function recordStudyActivity(
  prisma: PrismaService,
  userId: string,
  id: string,
) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const session = await tx.studySession.findUnique({ where: { id } });
    if (!session || session.userId !== userId)
      throw new NotFoundException({
        code: 'SESSION_NOT_FOUND',
        message: 'Study session not found',
      });
    if (session.status !== SessionStatus.ACTIVE)
      return { activeSeconds: session.activeSeconds, accepted: false };
    const credited = accountableActivitySeconds(session, now);
    const updated = await tx.studySession.update({
      where: { id },
      data: {
        activeSeconds: { increment: credited },
        lastActivityAt: now,
      },
    });
    return { activeSeconds: updated.activeSeconds, accepted: credited > 0 };
  });
}
