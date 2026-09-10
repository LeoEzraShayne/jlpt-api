import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const session = await this.auth.authenticate(
      request.cookies?.jlpt_session as string | undefined,
    );
    request.currentUser = session.user;
    request.sessionId = session.id;
    return true;
  }
}
