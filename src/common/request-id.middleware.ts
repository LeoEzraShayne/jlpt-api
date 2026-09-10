import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(
  request: Request & { requestId?: string },
  response: Response,
  next: NextFunction,
) {
  request.requestId =
    request.header('x-request-id')?.slice(0, 100) || randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
