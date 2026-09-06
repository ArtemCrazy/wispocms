import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function normalizeOrigins(value: string) {
  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function createOriginProtection(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins);

  return (request: Request, response: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(request.method.toUpperCase())) {
      next();
      return;
    }

    const origin = request.header('origin')?.replace(/\/$/, '');
    const fetchSite = request.header('sec-fetch-site');
    const isCrossSite = fetchSite === 'cross-site';
    const hasDisallowedOrigin = Boolean(origin && !allowed.has(origin));

    if (isCrossSite || hasDisallowedOrigin) {
      response.status(403).json({
        statusCode: 403,
        message: 'Запрос с этого источника запрещён',
        error: 'Forbidden',
      });
      return;
    }

    next();
  };
}
