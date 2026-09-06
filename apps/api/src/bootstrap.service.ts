import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'bcryptjs';
import { Repository } from 'typeorm';
import {
  PlatformRole,
  SiteEntity,
  SiteType,
  UserEntity,
  WorkspaceEntity,
  WorkspaceMembershipEntity,
  WorkspaceRole,
} from './database/entities';

@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaces: Repository<WorkspaceEntity>,
    @InjectRepository(SiteEntity)
    private readonly sites: Repository<SiteEntity>,
    @InjectRepository(WorkspaceMembershipEntity)
    private readonly memberships: Repository<WorkspaceMembershipEntity>,
  ) {}

  async onApplicationBootstrap() {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (!email || !password) {
      this.logger.warn('Bootstrap admin credentials are not configured');
      return;
    }

    let user = await this.users.findOne({ where: { email } });
    if (!user) {
      user = await this.users.save(
        this.users.create({
          email,
          passwordHash: await hash(password, 12),
          fullName: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Wispo Admin',
          platformRole: PlatformRole.WISPO_ADMIN,
          isActive: true,
        }),
      );
      this.logger.log(`Created bootstrap administrator ${email}`);
    }

    let workspace = await this.workspaces.findOne({
      where: { slug: 'crazy-studio' },
    });
    if (!workspace) {
      workspace = await this.workspaces.save(
        this.workspaces.create({ name: 'Crazy Studio', slug: 'crazy-studio' }),
      );
    }

    const membership = await this.memberships.findOne({
      where: { userId: user.id, workspaceId: workspace.id },
    });
    if (!membership) {
      await this.memberships.save(
        this.memberships.create({
          userId: user.id,
          workspaceId: workspace.id,
          role: WorkspaceRole.EMPLOYEE,
        }),
      );
    }

    const site = await this.sites.findOne({
      where: { workspaceId: workspace.id, slug: 'wispo-media' },
    });
    if (!site) {
      await this.sites.save(
        this.sites.create({
          workspaceId: workspace.id,
          name: 'Wispo Media',
          slug: 'wispo-media',
          domain: 'wispo.media',
          siteType: SiteType.MEDIA,
          isActive: true,
          createdByUserId: user.id,
        }),
      );
    }
  }
}
