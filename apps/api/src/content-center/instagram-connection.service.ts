import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { instagramUsername } from './social-address';
import {
  decryptSocialSecret,
  encryptSocialSecret,
  SocialSourceError,
} from './social-api';
import { InstagramSourceClient } from './instagram-source';
import {
  PlatformSocialSettingsService,
  validateInstagramRedirect,
} from './platform-social-settings.service';

type Material = {
  id: string;
  source_url: string;
  revision: number;
  kind: string;
  url_category: string;
};
type Connection = {
  account_id: string;
  username: string;
  encrypted_token: string;
  expires_at: string;
  app_revision: number;
};
type State = {
  workspace_id: string;
  material_id: string;
  material_revision: number;
  source_url: string;
  app_revision: number;
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class InstagramConnectionService {
  constructor(
    private readonly db: DataSource,
    private readonly settings: PlatformSocialSettingsService = new PlatformSocialSettingsService(
      db,
    ),
    private readonly client: InstagramSourceClient = new InstagramSourceClient(),
  ) {}
  private async material(
    workspaceId: string,
    id: string,
    db: Pick<EntityManager, 'query'> = this.db,
  ) {
    const [material] = await db.query<Material[]>(
      'SELECT id,source_url,revision,kind,url_category FROM cc_materials WHERE workspace_id=$1 AND id=$2',
      [workspaceId, id],
    );
    if (!material) throw new NotFoundException('Материал не найден');
    if (material.kind !== 'url' || material.url_category !== 'social')
      throw new BadRequestException('Выберите источник Instagram');
    instagramUsername(material.source_url);
    return material;
  }
  private async idle(manager: EntityManager, workspaceId: string) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `cc:${workspaceId}`,
    ]);
    const active = await manager.query<unknown[]>(
      "SELECT id FROM cc_preparation_runs WHERE workspace_id=$1 AND status IN ('queued','processing')",
      [workspaceId],
    );
    if (active.length)
      throw new ConflictException(
        'Дождитесь завершения обработки перед изменением подключения.',
      );
  }
  async status(workspaceId: string, id: string) {
    const material = await this.material(workspaceId, id);
    const platform = await this.settings.status('instagram');
    const [row] = await this.db.query<Connection[]>(
      'SELECT username,expires_at,app_revision FROM cc_instagram_connections WHERE workspace_id=$1 AND material_id=$2 AND source_url=$3',
      [workspaceId, id, material.source_url],
    );
    const ready = Boolean(
      row &&
      new Date(row.expires_at).getTime() > Date.now() &&
      row.app_revision === platform.revision &&
      platform.configured,
    );
    return {
      connected: Boolean(row),
      ready,
      platformConfigured: platform.configured,
      username: row?.username,
      expiresAt: row?.expires_at,
      redirectOrigin: platform.redirectUri
        ? new URL(platform.redirectUri).origin
        : null,
    };
  }
  async start(
    workspaceId: string,
    id: string,
    revision: number,
    userId: string,
    origin: string,
  ) {
    const material = await this.material(workspaceId, id);
    if (material.revision !== revision)
      throw new ConflictException('Источник изменился. Откройте его заново.');
    const app = await this.settings.credentials('instagram');
    const redirect = validateInstagramRedirect(app.redirect_uri ?? '');
    if (origin !== new URL(redirect).origin)
      throw new BadRequestException(
        `Откройте CMS на ${new URL(redirect).origin}, войдите и повторите подключение.`,
      );
    const state = randomBytes(32).toString('hex');
    await this.db.transaction(async (manager) => {
      await this.idle(manager, workspaceId);
      const current = await this.material(workspaceId, id, manager);
      if (current.revision !== revision)
        throw new ConflictException('Источник изменился.');
      await manager.query(
        'DELETE FROM cc_instagram_oauth_states WHERE expires_at < now() OR (user_id=$1 AND material_id=$2)',
        [userId, id],
      );
      await manager.query(
        "INSERT INTO cc_instagram_oauth_states(state_hash,user_id,workspace_id,material_id,material_revision,app_revision,source_url,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')",
        [
          hash(state),
          userId,
          workspaceId,
          id,
          revision,
          app.revision,
          material.source_url,
        ],
      );
    });
    const uri = new URL('https://www.instagram.com/oauth/authorize');
    uri.search = new URLSearchParams({
      client_id: app.app_id!,
      redirect_uri: redirect,
      response_type: 'code',
      scope: 'instagram_business_basic',
      state,
      enable_fb_login: '0',
      force_authentication: '1',
    }).toString();
    return { url: uri.href };
  }
  async complete(
    state: string,
    code: string,
    userId: string,
    authorize: (workspaceId: string) => Promise<unknown>,
  ) {
    if (!/^[a-f0-9]{64}$/.test(state) || !code || code.length > 4096)
      throw new BadRequestException(
        'Подключение истекло. Начните заново из CMS.',
      );
    // Single-use state is bound to the authenticated CMS user and material revision.
    const [pending] = await this.db.query<State[]>(
      'WITH consumed AS (DELETE FROM cc_instagram_oauth_states WHERE state_hash=$1 AND user_id=$2 AND expires_at>now() RETURNING workspace_id,material_id,material_revision,source_url,app_revision) SELECT * FROM consumed',
      [hash(state), userId],
    );
    if (!pending)
      throw new BadRequestException(
        'Подключение истекло или уже использовано.',
      );
    await authorize(pending.workspace_id);
    const app = await this.settings.credentials('instagram');
    if (app.revision !== pending.app_revision)
      throw new ConflictException(
        'Приложение изменилось. Начните подключение заново.',
      );
    const signal = AbortSignal.timeout(45_000);
    const credentials = await this.client.exchange(
      code,
      app.app_id!,
      app.secret,
      validateInstagramRedirect(app.redirect_uri!),
      signal,
    );
    const profile = await this.client.profile(credentials.token, signal);
    if (profile.username !== instagramUsername(pending.source_url))
      throw new BadRequestException(
        'Вы вошли в другой Instagram-аккаунт. Подключите профиль, указанный в источнике.',
      );
    await this.db.transaction(async (manager) => {
      await this.idle(manager, pending.workspace_id);
      const [currentApp] = await manager.query<Array<{ revision: number }>>(
        "SELECT revision FROM platform_social_settings WHERE network='instagram' AND encrypted_secret IS NOT NULL FOR SHARE",
      );
      if (currentApp?.revision !== app.revision)
        throw new ConflictException(
          'Приложение изменилось во время подключения.',
        );
      const changed = await manager.query<unknown[]>(
        "WITH changed AS (UPDATE cc_materials SET revision=revision+1,site_pages=NULL,site_checked_at=NULL,source_error=NULL,content='',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND source_url=$4 AND kind='url' AND url_category='social' RETURNING id) SELECT id FROM changed",
        [
          pending.workspace_id,
          pending.material_id,
          pending.material_revision,
          pending.source_url,
        ],
      );
      if (!changed.length)
        throw new ConflictException(
          'Источник изменён или удалён. Подключение не сохранено.',
        );
      await manager.query(
        `INSERT INTO cc_instagram_connections(workspace_id,material_id,source_url,account_id,username,encrypted_token,expires_at,app_revision)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (material_id) DO UPDATE SET source_url=EXCLUDED.source_url,account_id=EXCLUDED.account_id,username=EXCLUDED.username,encrypted_token=EXCLUDED.encrypted_token,expires_at=EXCLUDED.expires_at,app_revision=EXCLUDED.app_revision,updated_at=now() WHERE cc_instagram_connections.workspace_id=EXCLUDED.workspace_id`,
        [
          pending.workspace_id,
          pending.material_id,
          pending.source_url,
          profile.id,
          profile.username,
          encryptSocialSecret(
            credentials.token,
            `instagram:${pending.workspace_id}:${pending.material_id}`,
          ),
          credentials.expiresAt,
          app.revision,
        ],
      );
    });
    return pending.workspace_id;
  }
  async disconnect(workspaceId: string, id: string, revision: number) {
    await this.material(workspaceId, id);
    await this.db.transaction(async (manager) => {
      await this.idle(manager, workspaceId);
      const changed = await manager.query<unknown[]>(
        "WITH changed AS (UPDATE cc_materials SET revision=revision+1,site_pages=NULL,site_checked_at=NULL,content='',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id) SELECT id FROM changed",
        [workspaceId, id, revision],
      );
      if (!changed.length)
        throw new ConflictException('Источник изменился. Откройте его заново.');
      await manager.query(
        'DELETE FROM cc_instagram_connections WHERE workspace_id=$1 AND material_id=$2',
        [workspaceId, id],
      );
      await manager.query(
        'DELETE FROM cc_instagram_oauth_states WHERE workspace_id=$1 AND material_id=$2',
        [workspaceId, id],
      );
    });
    return this.status(workspaceId, id);
  }
  async collect(
    workspaceId: string,
    id: string | undefined,
    revision: number | undefined,
    url: string,
    signal: AbortSignal,
  ) {
    const [row] = await this.db.query<Connection[]>(
      `SELECT c.account_id,c.username,c.encrypted_token,c.expires_at,c.app_revision FROM cc_instagram_connections c JOIN cc_materials m ON m.workspace_id=c.workspace_id AND m.id=c.material_id AND m.source_url=c.source_url WHERE m.workspace_id=$1 AND m.id=$2 AND m.revision=$3 AND m.source_url=$4 AND m.kind='url' AND m.url_category='social'`,
      [workspaceId, id, revision, url],
    );
    const app = await this.settings.status('instagram');
    if (
      !row ||
      !app.configured ||
      app.revision !== row.app_revision ||
      new Date(row.expires_at).getTime() <= Date.now()
    )
      throw new SocialSourceError(
        'Подключите Instagram-аккаунт владельца в информации об источнике.',
      );
    let token = decryptSocialSecret(
      row.encrypted_token,
      `instagram:${workspaceId}:${id}`,
    );
    if (new Date(row.expires_at).getTime() < Date.now() + 7 * 86400_000) {
      const refreshed = await this.client.refresh(token, signal);
      const changed = await this.db.query<unknown[]>(
        `WITH changed AS (UPDATE cc_instagram_connections c SET encrypted_token=$1,expires_at=$2,updated_at=now() FROM cc_materials m,platform_social_settings s WHERE c.workspace_id=$3 AND c.material_id=$4 AND c.encrypted_token=$5 AND c.app_revision=$6 AND m.id=c.material_id AND m.workspace_id=c.workspace_id AND m.revision=$7 AND m.source_url=c.source_url AND s.network='instagram' AND s.revision=c.app_revision AND s.encrypted_secret IS NOT NULL RETURNING c.material_id) SELECT material_id FROM changed`,
        [
          encryptSocialSecret(
            refreshed.token,
            `instagram:${workspaceId}:${id}`,
          ),
          refreshed.expiresAt,
          workspaceId,
          id,
          row.encrypted_token,
          app.revision,
          revision,
        ],
      );
      if (!changed.length)
        throw new SocialSourceError('Подключение изменилось. Повторите сбор.');
      token = refreshed.token;
    }
    return this.client.collect(token, row.account_id, row.username, signal);
  }
}
