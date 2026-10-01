import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import {
  AdminPasswordResetEntity,
  PlatformRole,
  UserEntity,
} from '../database/entities';
import { SlidingWindowRateLimiter } from '../common/sliding-window-rate-limiter';
import { AuthMailerService } from './auth-mailer.service';

const resetLifetimeMs = 30 * 60 * 1000;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AdminPasswordResetService {
  private readonly requests = new SlidingWindowRateLimiter(15 * 60 * 1000, 3);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(AdminPasswordResetEntity)
    private readonly resets: Repository<AdminPasswordResetEntity>,
    private readonly dataSource: DataSource,
    private readonly mailer: AuthMailerService,
  ) {}

  async request(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId, isActive: true },
    });
    if (!user || user.platformRole !== PlatformRole.WISPO_ADMIN)
      throw new BadRequestException(
        'Подтверждение по email доступно только администратору Wispo',
      );
    if (this.requests.isBlocked(userId))
      throw new BadRequestException(
        'Ссылка уже запрашивалась несколько раз. Повторите попытку через 15 минут',
      );
    this.requests.record(userId);

    const rawToken = randomBytes(32).toString('base64url');
    const now = new Date();
    await this.resets.update(
      { userId, consumedAt: IsNull() },
      { consumedAt: now },
    );
    await this.resets.save(
      this.resets.create({
        userId,
        tokenHash: tokenHash(rawToken),
        expiresAt: new Date(now.getTime() + resetLifetimeMs),
        consumedAt: null,
      }),
    );

    const baseUrl = (
      process.env.PUBLIC_APP_URL ??
      process.env.WEB_ORIGIN?.split(',')[0] ??
      'http://localhost:3000'
    ).replace(/\/$/, '');
    await this.mailer.sendAdminPasswordReset({
      email: user.email,
      fullName: user.fullName,
      url: `${baseUrl}/reset-admin-password?token=${encodeURIComponent(rawToken)}`,
    });
    return { ok: true };
  }

  async complete(rawToken: string, newPassword: string) {
    const reset = await this.resets.findOne({
      where: {
        tokenHash: tokenHash(rawToken),
        consumedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
    });
    if (!reset)
      throw new BadRequestException(
        'Ссылка недействительна или срок её действия истёк',
      );

    const user = await this.users.findOne({
      where: {
        id: reset.userId,
        isActive: true,
        platformRole: PlatformRole.WISPO_ADMIN,
      },
    });
    if (!user)
      throw new BadRequestException('Аккаунт администратора недоступен');
    if (await compare(newPassword, user.passwordHash))
      throw new BadRequestException(
        'Новый пароль должен отличаться от текущего',
      );

    user.passwordHash = await hash(newPassword, 12);
    user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    const consumedAt = new Date();
    await this.dataSource.transaction(async (manager) => {
      await manager.save(UserEntity, user);
      await manager.update(
        AdminPasswordResetEntity,
        { userId: user.id, consumedAt: IsNull() },
        { consumedAt },
      );
    });
    return { ok: true };
  }
}
