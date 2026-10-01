import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard, type AuthenticatedRequest } from './jwt-auth.guard';
import { ChangePasswordDto } from './change-password.dto';
import { LoginDto } from './login.dto';
import { CompleteAdminPasswordResetDto } from './admin-password-reset.dto';
import { AdminPasswordResetService } from './admin-password-reset.service';

const sessionCookie = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.COOKIE_SECURE === 'true',
  maxAge: 12 * 60 * 60 * 1000,
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminPasswordReset: AdminPasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const forwarded = request.headers['x-forwarded-for'];
    const address = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded;
    const clientKey =
      address?.split(',').at(-1)?.trim() || request.ip || 'unknown';
    const result = await this.authService.login(
      dto.email,
      dto.password,
      clientKey,
    );
    response.cookie('wispo_session', result.token, sessionCookie);
    return result.session;
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() request: AuthenticatedRequest) {
    return this.authService.getSession(request.auth!.userId);
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  changePassword(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.authService.changePassword(
      request.auth!.userId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  @Post('admin-password-reset/request')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  requestAdminPasswordReset(@Req() request: AuthenticatedRequest) {
    return this.adminPasswordReset.request(request.auth!.userId);
  }

  @Post('admin-password-reset/complete')
  @HttpCode(200)
  async completeAdminPasswordReset(
    @Body() dto: CompleteAdminPasswordResetDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.adminPasswordReset.complete(
      dto.token,
      dto.newPassword,
    );
    response.clearCookie('wispo_session', {
      ...sessionCookie,
      maxAge: undefined,
    });
    return result;
  }

  @Post('logout')
  @HttpCode(204)
  logout(
    @Req() _request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.clearCookie('wispo_session', {
      ...sessionCookie,
      maxAge: undefined,
    });
  }
}
