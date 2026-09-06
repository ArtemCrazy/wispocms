import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/jwt-auth.guard';
import { PlatformRole } from '../database/entities';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.auth?.platformRole !== PlatformRole.WISPO_ADMIN) {
      throw new ForbiddenException('Доступно только администратору Wispo');
    }
    return true;
  }
}
