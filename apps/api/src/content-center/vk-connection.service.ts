import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { decryptVkToken } from './vk-secret';
import { VkSourceClient, VkSourceError, vkCommunityAddress } from './vk-source';
import { PlatformVkSettingsService } from './platform-vk-settings.service';

type VkMaterial = {
  id: string;
  source_url: string;
  revision: number;
  kind: string;
  url_category: string;
};

@Injectable()
export class VkConnectionService {
  constructor(
    private readonly db: DataSource,
    private readonly client: VkSourceClient = new VkSourceClient(),
    private readonly settings: PlatformVkSettingsService = new PlatformVkSettingsService(
      db,
    ),
  ) {}

  private async material(
    workspaceId: string,
    id: string,
    manager: Pick<EntityManager, 'query'> = this.db,
  ): Promise<VkMaterial> {
    const [material] = await manager.query<VkMaterial[]>(
      'SELECT id,source_url,revision,kind,url_category FROM cc_materials WHERE workspace_id=$1 AND id=$2',
      [workspaceId, id],
    );
    if (!material) throw new NotFoundException('Материал не найден');
    if (material.kind !== 'url' || material.url_category !== 'social')
      throw new BadRequestException(
        'Подключение доступно только для сообщества VK',
      );
    vkCommunityAddress(material.source_url);
    return material;
  }

  async status(workspaceId: string, id: string) {
    const material = await this.material(workspaceId, id);
    const [row] = await this.db.query<
      Array<{
        group_id: string;
        group_name: string;
        updated_at: string;
        legacy: boolean;
      }>
    >(
      'SELECT group_id,group_name,updated_at,encrypted_token IS NOT NULL AS legacy FROM cc_vk_connections WHERE workspace_id=$1 AND material_id=$2 AND source_url=$3',
      [workspaceId, id, material.source_url],
    );
    const platform = await this.settings.status();
    return row
      ? {
          connected: true,
          ready: row.legacy ? platform.storageReady : platform.configured,
          platformConfigured: platform.configured,
          groupName: row.group_name,
          updatedAt: row.updated_at,
        }
      : {
          connected: false,
          ready: false,
          platformConfigured: platform.configured,
        };
  }

  private async lockIdle(manager: EntityManager, workspaceId: string) {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `cc:${workspaceId}`,
    ]);
    const runs = await manager.query<Array<{ id: string }>>(
      "SELECT id FROM cc_preparation_runs WHERE workspace_id=$1 AND status IN ('queued','processing')",
      [workspaceId],
    );
    if (runs.length)
      throw new ConflictException(
        'Дождитесь завершения текущей обработки перед изменением подключения VK',
      );
  }

  async connect(workspaceId: string, id: string, revision: number) {
    const material = await this.material(workspaceId, id);
    if (material.revision !== revision)
      throw new ConflictException('Источник изменён. Откройте его заново.');
    const { token, revision: keyRevision } = await this.settings.credentials();
    let community;
    try {
      const signal = AbortSignal.timeout(35_000);
      community = await this.client.community(
        token,
        material.source_url,
        signal,
        false,
      );
      await this.client.posts(token, community.id, 0, signal, 1);
    } catch (error) {
      throw new BadRequestException(
        error instanceof VkSourceError
          ? error.message
          : 'Не удалось проверить подключение VK. Попробуйте позже.',
      );
    }
    await this.db.transaction(async (manager) => {
      await this.lockIdle(manager, workspaceId);
      const [currentKey] = await manager.query<Array<{ revision: number }>>(
        "SELECT revision FROM platform_vk_settings WHERE id='vk' AND encrypted_key IS NOT NULL FOR SHARE",
      );
      if (currentKey?.revision !== keyRevision)
        throw new ConflictException(
          'Общее подключение VK изменено. Повторите подключение источника.',
        );
      const changed = await manager.query<Array<{ id: string }>>(
        "UPDATE cc_materials SET revision=revision+1,site_pages=NULL,site_checked_at=NULL,source_error=NULL,content='',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND source_url=$4 AND kind='url' AND url_category='social' RETURNING id",
        [workspaceId, id, revision, material.source_url],
      );
      if (!changed.length)
        throw new ConflictException(
          'Источник изменён. Подключение не сохранено.',
        );
      await manager.query(
        `INSERT INTO cc_vk_connections(workspace_id,material_id,source_url,group_id,group_name,encrypted_token) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (material_id) DO UPDATE SET source_url=EXCLUDED.source_url,group_id=EXCLUDED.group_id,group_name=EXCLUDED.group_name,encrypted_token=EXCLUDED.encrypted_token,updated_at=now() WHERE cc_vk_connections.workspace_id=EXCLUDED.workspace_id`,
        [
          workspaceId,
          id,
          material.source_url,
          community.id,
          community.name,
          null,
        ],
      );
    });
    return this.status(workspaceId, id);
  }

  async disconnect(workspaceId: string, id: string, revision: number) {
    await this.material(workspaceId, id);
    await this.db.transaction(async (manager) => {
      await this.lockIdle(manager, workspaceId);
      const changed = await manager.query<Array<{ id: string }>>(
        "UPDATE cc_materials SET revision=revision+1,site_pages=NULL,site_checked_at=NULL,content='',updated_at=now() WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id",
        [workspaceId, id, revision],
      );
      if (!changed.length)
        throw new ConflictException('Источник изменён. Откройте его заново.');
      await manager.query(
        'DELETE FROM cc_vk_connections WHERE workspace_id=$1 AND material_id=$2',
        [workspaceId, id],
      );
    });
    return this.status(workspaceId, id);
  }

  async collect(
    workspaceId: string,
    id: string | undefined,
    revision: number | undefined,
    sourceUrl: string,
    signal: AbortSignal,
  ) {
    const [connection] = await this.db.query<
      Array<{ encrypted_token: string | null; group_id: string }>
    >(
      `SELECT c.encrypted_token,c.group_id FROM cc_vk_connections c JOIN cc_materials m ON m.workspace_id=c.workspace_id AND m.id=c.material_id
      WHERE c.workspace_id=$1 AND c.material_id=$2 AND c.source_url=$3 AND m.source_url=c.source_url AND m.revision=$4 AND m.kind='url' AND m.url_category='social'`,
      [workspaceId, id, sourceUrl, revision],
    );
    if (!connection)
      throw new VkSourceError(
        'Сообщество VK не подключено или ссылка изменилась. Откройте информацию об источнике и подключите VK.',
      );
    const token = connection.encrypted_token
      ? decryptVkToken(connection.encrypted_token, workspaceId, id!)
      : (await this.settings.credentials()).token;
    const community = await this.client.community(
      token,
      sourceUrl,
      signal,
      Boolean(connection.encrypted_token),
    );
    if (community.id !== Number(connection.group_id))
      throw new VkSourceError(
        'Адрес VK теперь указывает на другое сообщество. Подключите источник заново.',
      );
    return this.client.collect(token, community, signal);
  }
}
