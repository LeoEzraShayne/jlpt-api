import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { billingError } from '../billing/billing.policy';
import {
  ANDROID_CALLBACK_PATHS,
  ANDROID_SCOPES,
  type AndroidBindingInput,
} from '../contracts/android-commerce';
import { androidHash, AndroidPolicy } from './android.policy';

@Injectable()
export class AndroidAuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly policy: AndroidPolicy,
  ) {}
  async start(input: AndroidBindingInput) {
    this.policy.assertClient(input.clientId);
    const request = await this.db.androidBindingRequest.create({
      data: {
        ...input,
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    const url = new URL(
      '/android/link',
      this.policy.config.getOrThrow<string>('FRONTEND_URL'),
    );
    url.searchParams.set('bindingId', request.id);
    return {
      bindingId: request.id,
      authorizationUrl: url.toString(),
      expiresAt: request.expiresAt.toISOString(),
    };
  }
  async details(id: string) {
    this.policy.assertEnabled();
    const row = await this.db.androidBindingRequest.findUnique({
      where: { id },
    });
    if (!row || row.expiresAt <= new Date() || row.consumedAt)
      billingError('BINDING_EXPIRED', 410);
    this.policy.assertClient(row.clientId);
    return {
      clientId: row.clientId,
      expiresAt: row.expiresAt.toISOString(),
      scopes: ANDROID_SCOPES,
    };
  }
  private async source(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
  ) {
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${id} FOR UPDATE`;
    const session = await tx.authSession.findUnique({ where: { id } });
    if (
      !session ||
      session.userId !== userId ||
      session.expiresAt <= new Date()
    )
      billingError('SESSION_EXPIRED', 401);
    return session;
  }
  async approve(id: string, userId: string, sourceSessionId: string) {
    this.policy.assertEnabled();
    return this.db.$transaction(async (tx) => {
      await this.source(tx, sourceSessionId, userId);
      await tx.$queryRaw`SELECT id FROM "AndroidBindingRequest" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.androidBindingRequest.findUnique({ where: { id } });
      if (
        !row ||
        row.expiresAt <= new Date() ||
        row.approvedAt ||
        row.consumedAt
      )
        billingError('BINDING_EXPIRED', 410);
      this.policy.assertClient(row.clientId);
      const code = randomBytes(32).toString('base64url');
      await tx.androidBindingRequest.update({
        where: { id },
        data: {
          userId,
          sourceSessionId,
          codeHash: androidHash(code),
          approvedAt: new Date(),
          codeExpiresAt: new Date(
            Math.min(row.expiresAt.getTime(), Date.now() + 60_000),
          ),
        },
      });
      const path =
        ANDROID_CALLBACK_PATHS[
          row.clientId as keyof typeof ANDROID_CALLBACK_PATHS
        ];
      const url = new URL(
        path,
        this.policy.config.getOrThrow<string>('FRONTEND_URL'),
      );
      url.searchParams.set('code', code);
      url.searchParams.set('state', row.state);
      return { callbackUrl: url.toString() };
    });
  }
  async exchange(clientId: string, code: string, verifier: string) {
    this.policy.assertClient(clientId);
    const hash = androidHash(code);
    return this.db.$transaction(async (tx) => {
      const initial = await tx.androidBindingRequest.findUnique({
        where: { codeHash: hash },
      });
      if (!initial?.userId || !initial.sourceSessionId)
        billingError('BINDING_INVALID', 401);
      const source = await this.source(
        tx,
        initial.sourceSessionId,
        initial.userId,
      );
      await tx.$queryRaw`SELECT id FROM "AndroidBindingRequest" WHERE id = ${initial.id} FOR UPDATE`;
      const row = await tx.androidBindingRequest.findUniqueOrThrow({
        where: { id: initial.id },
      });
      const challenge = Buffer.from(androidHash(verifier), 'hex').toString(
        'base64url',
      );
      if (
        row.clientId !== clientId ||
        row.consumedAt ||
        !row.codeExpiresAt ||
        row.codeExpiresAt <= new Date() ||
        row.expiresAt <= new Date() ||
        challenge.length !== row.codeChallenge.length ||
        !timingSafeEqual(Buffer.from(challenge), Buffer.from(row.codeChallenge))
      )
        billingError('BINDING_INVALID', 401);
      await tx.user.updateMany({
        where: { id: initial.userId, googlePlayAccountId: null },
        data: { googlePlayAccountId: randomBytes(32).toString('base64url') },
      });
      const user = await tx.user.findUniqueOrThrow({
        where: { id: initial.userId },
      });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(
        Math.min(source.expiresAt.getTime(), Date.now() + 60 * 60_000),
      );
      await tx.androidSession.create({
        data: {
          userId: user.id,
          sourceSessionId: source.id,
          tokenHash: androidHash(token),
          clientId,
          scopes: [...ANDROID_SCOPES],
          expiresAt,
        },
      });
      await tx.androidBindingRequest.update({
        where: { id: row.id },
        data: { consumedAt: new Date() },
      });
      return {
        accessToken: token,
        tokenType: 'Bearer' as const,
        expiresAt: expiresAt.toISOString(),
        scopes: ANDROID_SCOPES,
        user: { id: user.id, displayName: user.displayName, email: user.email },
        googlePlayAccountId: user.googlePlayAccountId!,
      };
    });
  }
  async authenticate(raw: string | undefined) {
    this.policy.assertEnabled();
    if (!raw || !/^Bearer [A-Za-z0-9_-]{43}$/.test(raw))
      billingError('AUTH_REQUIRED', 401);
    const session = await this.db.androidSession.findUnique({
      where: { tokenHash: androidHash(raw.slice(7)) },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date())
      billingError('SESSION_EXPIRED', 401);
    this.policy.assertClient(session.clientId);
    const source = await this.db.authSession.findUnique({
      where: { id: session.sourceSessionId },
    });
    if (
      !source ||
      source.userId !== session.userId ||
      source.expiresAt <= new Date()
    )
      billingError('SESSION_EXPIRED', 401);
    const user = await this.db.user.findUniqueOrThrow({
      where: { id: session.userId },
    });
    return { session, user };
  }
  async logout(id: string) {
    await this.db.androidSession.updateMany({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }
}
