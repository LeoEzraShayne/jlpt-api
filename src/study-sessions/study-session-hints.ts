import { NotFoundException } from '@nestjs/common';
import { SessionMode, SessionStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export async function revealStudyHint(
  prisma: PrismaService,
  userId: string,
  id: string,
) {
  const session = await prisma.studySession.findUnique({ where: { id } });
  if (!session || session.userId !== userId)
    throw new NotFoundException({
      code: 'SESSION_NOT_FOUND',
      message: 'Study session not found',
    });
  if (session.status !== SessionStatus.ACTIVE) return session;
  return prisma.studySession.update({
    where: { id },
    data: {
      revealedAt: session.revealedAt ?? new Date(),
      hintRevealCount:
        session.mode === SessionMode.REVIEW ? { increment: 1 } : undefined,
    },
  });
}
