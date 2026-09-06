import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SiteEntity,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
} from '../database/entities';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      WorkspaceEntity,
      SiteEntity,
      WorkspaceMembershipEntity,
    ]),
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET is required');
        return { secret, signOptions: { expiresIn: 12 * 60 * 60 } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
