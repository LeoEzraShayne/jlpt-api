import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host
      .switchToHttp()
      .getRequest<Request & { requestId?: string }>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : null;
    const details = typeof body === 'object' && body ? body : undefined;
    const message =
      typeof body === 'string' ? body : this.getMessage(body, status);
    response.status(status).json({
      error: {
        code: this.getCode(typeof body === 'object' ? body : null, status),
        message,
        details,
        requestId: request.requestId,
      },
    });
  }

  private getMessage(body: object | null, status: number) {
    if (body && 'message' in body) {
      const value = body.message;
      return Array.isArray(value) ? value.join('; ') : String(value);
    }
    return status === 500 ? 'Internal server error' : 'Request failed';
  }

  private getCode(body: object | null, status: number) {
    if (body && 'code' in body) return String(body.code);
    return `HTTP_${status}`;
  }
}
