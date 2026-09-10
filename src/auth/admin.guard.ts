import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.currentUser?.role !== 'ADMIN')
      throw new ForbiddenException({
        code: 'ADMIN_REQUIRED',
        message: 'Administrator access required',
      });
    return true;
  }
}
