import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))
      return true;
    if (this.config.get('NODE_ENV') !== 'production') return true;
    if (
      request.method === 'POST' &&
      request.path === '/api/v1/billing/webhooks/stripe'
    )
      return true;
    const origin = request.header('origin');
    if (origin !== this.config.get('FRONTEND_URL'))
      throw new ForbiddenException({
        code: 'INVALID_ORIGIN',
        message: 'Invalid request origin',
      });
    return true;
  }
}
