import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AndroidScope } from '../contracts/android-commerce';
import { billingError } from '../billing/billing.policy';
import { AndroidAuthService } from './android-auth.service';
export const AndroidScopeRequired = (scope: AndroidScope) =>
  SetMetadata('androidScope', scope);
@Injectable()
export class AndroidSessionGuard implements CanActivate {
  constructor(
    private readonly auth: AndroidAuthService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    const { session, user } = await this.auth.authenticate(
      req.header('authorization'),
    );
    const scope = this.reflector.getAllAndOverride<string>('androidScope', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (scope && !session.scopes.includes(scope))
      billingError('ANDROID_SCOPE_REQUIRED', 403);
    req.currentUser = user;
    req.sessionId = session.id;
    return true;
  }
}
