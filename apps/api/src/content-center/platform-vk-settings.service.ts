import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { encryptionKey } from '../ai/ai-secret';
import { decryptVkToken, encryptVkToken } from './vk-secret';
import { VkSourceClient, VkSourceError, vkCommunityAddress } from './vk-source';

type Row = {
  encrypted_key: string | null;
  revision: number;
  updated_at: string | null;
  verified_at: string | null;
};

@Injectable()
export class PlatformVkSettingsService {
  constructor(
    private readonly db: DataSource,
    private readonly client: VkSourceClient = new VkSourceClient(),
  ) {}

  private async row(): Promise<Row> {
    const [row] = await this.db.query<Row[]>(
      "SELECT encrypted_key,revision,updated_at,verified_at FROM platform_vk_settings WHERE id='vk'",
    );
    if (!row) throw new ServiceUnavailableException('Настройки VK недоступны');
    return row;
  }

  async status() {
    const row = await this.row();
    let storageReady = false;
    try {
      encryptionKey();
      storageReady = true;
    } catch {
      /* fail closed */
    }
    return {
      configured: Boolean(row.encrypted_key) && storageReady,
      hasKey: Boolean(row.encrypted_key),
      storageReady,
      revision: row.revision,
      updatedAt: row.updated_at,
      verifiedAt: row.verified_at,
    };
  }

  async save(input: { token: string; revision: number }, actorId: string) {
    const token = input.token.trim();
    if (!/^[A-Za-z0-9_.-]{16,1024}$/.test(token))
      throw new BadRequestException(
        'Введите сервисный ключ приложения VK без пробелов',
      );
    const encrypted = encryptVkToken(token, 'platform', 'vk-service');
    const changed = await this.db.query<Array<{ revision: number }>>(
      "WITH changed AS (UPDATE platform_vk_settings SET encrypted_key=$1,revision=revision+1,updated_at=now(),updated_by=$2,verified_at=NULL WHERE id='vk' AND revision=$3 RETURNING revision) SELECT revision FROM changed",
      [encrypted, actorId, input.revision],
    );
    if (!changed.length)
      throw new ConflictException('Настройки уже изменены. Обновите страницу.');
    return this.status();
  }

  async remove(revision: number, actorId: string) {
    const changed = await this.db.query<Array<{ revision: number }>>(
      "WITH changed AS (UPDATE platform_vk_settings SET encrypted_key=NULL,revision=revision+1,updated_at=now(),updated_by=$1,verified_at=NULL WHERE id='vk' AND revision=$2 RETURNING revision) SELECT revision FROM changed",
      [actorId, revision],
    );
    if (!changed.length)
      throw new ConflictException('Настройки уже изменены. Обновите страницу.');
    return this.status();
  }

  async credentials() {
    const row = await this.row();
    if (!row.encrypted_key)
      throw new ServiceUnavailableException(
        'Администратор CMS должен настроить общее подключение VK в настройках платформы. Ключ заказчика не нужен.',
      );
    return {
      token: decryptVkToken(row.encrypted_key, 'platform', 'vk-service'),
      revision: row.revision,
    };
  }

  async check(sourceUrl: string) {
    vkCommunityAddress(sourceUrl);
    const { token, revision } = await this.credentials();
    let community;
    try {
      const signal = AbortSignal.timeout(35_000);
      community = await this.client.community(token, sourceUrl, signal, false);
      await this.client.posts(token, community.id, 0, signal, 1);
    } catch (error) {
      throw new BadRequestException(
        error instanceof VkSourceError
          ? error.message
          : 'Не удалось проверить доступ VK. Попробуйте позже.',
      );
    }
    const changed = await this.db.query<Array<{ revision: number }>>(
      "WITH changed AS (UPDATE platform_vk_settings SET verified_at=now() WHERE id='vk' AND revision=$1 AND encrypted_key IS NOT NULL RETURNING revision) SELECT revision FROM changed",
      [revision],
    );
    if (!changed.length)
      throw new ConflictException(
        'Ключ изменён во время проверки. Проверьте новое подключение.',
      );
    return { ...(await this.status()), checkedGroupName: community.name };
  }
}
