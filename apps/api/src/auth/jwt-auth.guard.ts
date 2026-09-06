import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PlatformRole } from '../database/entities';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  auth?: { userId: string; platformRole: PlatformRole };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.wispo_session as string | undefined;

    if (!token) {
      throw new UnauthorizedException('Требуется авторизация');
    }

    try {
      const payload = await this.jwtService.verifyAsync<{
        sub: string;
        role: PlatformRole;
      }>(token);
      const user = await this.authService.getActiveIdentity(payload.sub);
      if (!user) throw new UnauthorizedException('Сессия недействительна');
      request.auth = {
        userId: user.id,
        platformRole: user.platformRole,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Сессия недействительна');
    }
  }
}
