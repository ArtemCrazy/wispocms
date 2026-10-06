import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { Request } from 'express';

const RELEASE_TOKEN_HEADER = 'x-wispo-release-token';

function digest(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function secureTokenEquals(actual: string, expected: string): boolean {
  return crypto.timingSafeEqual(digest(actual), digest(expected));
}

@Injectable()
export class ReleaseTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configured = process.env.WISPO_RELEASE_TOKEN;
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.headers[RELEASE_TOKEN_HEADER];

    if (
      typeof configured !== 'string' ||
      configured.trim().length === 0 ||
      typeof presented !== 'string' ||
      presented.length === 0 ||
      !secureTokenEquals(presented, configured)
    ) {
      throw new UnauthorizedException('Недействительный служебный доступ');
    }
    return true;
  }
}
