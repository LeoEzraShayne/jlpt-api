import { createHash, randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import type { GoogleProfile } from './google.strategy';

const SESSION_DAYS = 7;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async loginWithGoogle(profile: GoogleProfile) {
    const adminEmail = this.config.get<string>('ADMIN_EMAIL')?.toLowerCase();
    const user = await this.prisma.$transaction(async (tx) => {
      const account = await tx.authAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: 'google',
            providerAccountId: profile.providerId,
          },
        },
        include: { user: true },
      });
      if (account)
        return tx.user.update({
          where: { id: account.userId },
          data: {
            email: profile.email,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
          },
        });
      const existing = await tx.user.findUnique({
        where: { email: profile.email },
      });
      const userRecord = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            },
          })
        : await tx.user.create({
            data: {
              email: profile.email,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
              role:
                profile.email.toLowerCase() === adminEmail ? 'ADMIN' : 'USER',
            },
          });
      await tx.authAccount.create({
        data: {
          userId: userRecord.id,
          provider: 'google',
          providerAccountId: profile.providerId,
        },
      });
      return userRecord;
    });
    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
    await this.prisma.authSession.create({
      data: { userId: user.id, tokenHash: this.hashToken(rawToken), expiresAt },
    });
    return { rawToken, expiresAt, user };
  }

  async authenticate(rawToken?: string) {
    if (!rawToken)
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      });
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: true },
    });
    if (!session || session.expiresAt <= new Date())
      throw new UnauthorizedException({
        code: 'SESSION_EXPIRED',
        message: 'Session expired',
      });
    return session;
  }

  async logout(rawToken?: string) {
    if (rawToken)
      await this.prisma.authSession.deleteMany({
        where: { tokenHash: this.hashToken(rawToken) },
      });
  }

  private hashToken(token: string) {
    return createHash('sha256')
      .update(`${token}:${this.config.getOrThrow('SESSION_SECRET')}`)
      .digest('hex');
  }
}
