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
      [
        '/api/v1/billing/webhooks/stripe',
        '/api/v1/android/auth/bindings',
        '/api/v1/android/auth/exchange',
        '/api/v1/android/auth/logout',
        '/api/v1/android/commerce/google/purchases/verify',
        '/api/v1/android/commerce/google/rtdn',
        '/api/v1/android/commerce/reward-tickets',
      ].includes(request.path)
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
