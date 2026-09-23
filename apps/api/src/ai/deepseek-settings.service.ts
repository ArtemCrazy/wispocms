import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { decryptApiKey, encryptApiKey, encryptionKey } from './ai-secret';

export const DEEPSEEK_MODELS = ['deepseek-flash', 'deepseek-v4-pro'] as const;
type Row = {
  encrypted_key: string | null;
  model: string;
  revision: number;
  updated_at: string | null;
  verified_at: string | null;
};

@Injectable()
export class DeepseekSettingsService implements OnModuleInit {
  configured = false;
  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.status();
  }

  private async row(): Promise<Row> {
    const rows: Row[] = await this.db.query(
      `SELECT encrypted_key,model,revision,updated_at,verified_at FROM platform_ai_settings WHERE id='deepseek'`,
    );
    if (!rows[0])
      throw new ServiceUnavailableException('Настройки DeepSeek недоступны');
    return rows[0];
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
    this.configured = Boolean(row.encrypted_key) && storageReady;
    return {
      configured: this.configured,
      hasKey: Boolean(row.encrypted_key),
      storageReady,
      model: row.model,
      revision: row.revision,
      updatedAt: row.updated_at,
      verifiedAt: row.verified_at,
      models: DEEPSEEK_MODELS,
    };
  }

  async save(
    input: { apiKey?: string; model: string; revision: number },
    actorId: string,
  ) {
    encryptionKey();
    if (
      !DEEPSEEK_MODELS.includes(input.model as (typeof DEEPSEEK_MODELS)[number])
    )
      throw new BadRequestException('Выберите поддерживаемую модель DeepSeek');
    const row = await this.row();
    const apiKey = input.apiKey?.trim();
    if (apiKey !== undefined && !/^[A-Za-z0-9_-]{16,256}$/.test(apiKey))
      throw new BadRequestException('Введите API-ключ DeepSeek без пробелов');
    if (!apiKey && !row.encrypted_key)
      throw new BadRequestException('Введите API-ключ DeepSeek');
    const encrypted = apiKey ? encryptApiKey(apiKey) : row.encrypted_key;
    const changed: { revision: number }[] = await this.db.query(
      `WITH changed AS (UPDATE platform_ai_settings SET encrypted_key=$1,model=$2,revision=revision+1,updated_at=now(),updated_by=$3,verified_at=NULL WHERE id='deepseek' AND revision=$4 RETURNING revision) SELECT revision FROM changed`,
      [encrypted, input.model, actorId, input.revision],
    );
    if (!changed.length)
      throw new ConflictException('Настройки уже изменены. Обновите страницу.');
    return this.status();
  }

  async remove(revision: number, actorId: string) {
    const changed: { revision: number }[] = await this.db.query(
      `WITH changed AS (UPDATE platform_ai_settings SET encrypted_key=NULL,revision=revision+1,updated_at=now(),updated_by=$1,verified_at=NULL WHERE id='deepseek' AND revision=$2 RETURNING revision) SELECT revision FROM changed`,
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
        'Сначала сохраните ключ DeepSeek в настройках платформы',
      );
    return {
      apiKey: decryptApiKey(row.encrypted_key),
      model: row.model,
      revision: row.revision,
    };
  }

  async markVerified(revision: number) {
    const changed: { revision: number }[] = await this.db.query(
      `WITH changed AS (UPDATE platform_ai_settings SET verified_at=now() WHERE id='deepseek' AND revision=$1 AND encrypted_key IS NOT NULL RETURNING revision) SELECT revision FROM changed`,
      [revision],
    );
    if (!changed.length)
      throw new ConflictException(
        'Ключ изменён во время проверки. Проверьте новое подключение.',
      );
    return this.status();
  }
}
