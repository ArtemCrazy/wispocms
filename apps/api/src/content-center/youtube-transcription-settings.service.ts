import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { encryptionKey } from '../ai/ai-secret';
import { decryptSocialSecret, encryptSocialSecret } from './social-api';

export const GROQ_WHISPER_MODELS = [
  'whisper-large-v3-turbo',
  'whisper-large-v3',
] as const;
export type GroqWhisperModel = (typeof GROQ_WHISPER_MODELS)[number];

type Row = {
  encrypted_key: string | null;
  model: GroqWhisperModel;
  revision: number;
  updated_at: string | null;
  verified_at: string | null;
};

const PURPOSE = 'platform:groq-whisper';

@Injectable()
export class YoutubeTranscriptionSettingsService implements OnModuleInit {
  configured = false;

  constructor(private readonly db: DataSource) {}

  async onModuleInit() {
    await this.status();
  }

  private async row(): Promise<Row> {
    const rows = await this.db.query<Row[]>(
      `SELECT encrypted_key,model,revision,updated_at,verified_at
       FROM platform_transcription_settings WHERE id='groq'`,
    );
    if (!rows[0])
      throw new ServiceUnavailableException(
        'Настройки расшифровки YouTube недоступны',
      );
    return rows[0];
  }

  async status() {
    const row = await this.row();
    let storageReady = false;
    try {
      encryptionKey();
      storageReady = true;
    } catch {
      // Fail closed: a key must never be accepted without encrypted storage.
    }
    this.configured = Boolean(row.encrypted_key) && storageReady;
    return {
      configured: this.configured,
      hasKey: Boolean(row.encrypted_key),
      storageReady,
      model: row.model,
      models: GROQ_WHISPER_MODELS,
      revision: row.revision,
      updatedAt: row.updated_at,
      verifiedAt: row.verified_at,
    };
  }

  async save(
    input: { apiKey?: string; model: string; revision: number },
    actorId: string,
  ) {
    encryptionKey();
    if (!GROQ_WHISPER_MODELS.includes(input.model as GroqWhisperModel))
      throw new BadRequestException(
        'Выберите поддерживаемую модель Groq Whisper',
      );
    const row = await this.row();
    const apiKey = input.apiKey?.trim();
    if (apiKey !== undefined && !/^[A-Za-z0-9_-]{16,256}$/.test(apiKey))
      throw new BadRequestException('Введите API-ключ Groq без пробелов');
    if (!apiKey && !row.encrypted_key)
      throw new BadRequestException('Введите API-ключ Groq');
    const encrypted = apiKey
      ? encryptSocialSecret(apiKey, PURPOSE)
      : row.encrypted_key;
    const changed = await this.db.query<Array<{ revision: number }>>(
      `WITH changed AS (
         UPDATE platform_transcription_settings
         SET encrypted_key=$1,model=$2,revision=revision+1,updated_at=now(),updated_by=$3,verified_at=NULL
         WHERE id='groq' AND revision=$4
         RETURNING revision
       ) SELECT revision FROM changed`,
      [encrypted, input.model, actorId, input.revision],
    );
    if (!changed.length)
      throw new ConflictException('Настройки уже изменены. Обновите страницу.');
    return this.status();
  }

  async remove(revision: number, actorId: string) {
    const changed = await this.db.query<Array<{ revision: number }>>(
      `WITH changed AS (
         UPDATE platform_transcription_settings
         SET encrypted_key=NULL,revision=revision+1,updated_at=now(),updated_by=$1,verified_at=NULL
         WHERE id='groq' AND revision=$2
         RETURNING revision
       ) SELECT revision FROM changed`,
      [actorId, revision],
    );
    if (!changed.length)
      throw new ConflictException('Настройки уже изменены. Обновите страницу.');
    this.configured = false;
    return this.status();
  }

  async credentials() {
    const row = await this.row();
    if (!row.encrypted_key)
      throw new ServiceUnavailableException(
        'Сначала сохраните ключ Groq в настройках платформы',
      );
    return {
      apiKey: decryptSocialSecret(row.encrypted_key, PURPOSE),
      model: row.model,
      revision: row.revision,
    };
  }

  async markVerified(revision: number) {
    const changed = await this.db.query<Array<{ revision: number }>>(
      `WITH changed AS (
         UPDATE platform_transcription_settings
         SET verified_at=now()
         WHERE id='groq' AND revision=$1 AND encrypted_key IS NOT NULL
         RETURNING revision
       ) SELECT revision FROM changed`,
      [revision],
    );
    if (!changed.length)
      throw new ConflictException(
        'Ключ изменён во время проверки. Проверьте новое подключение.',
      );
    return this.status();
  }
}
