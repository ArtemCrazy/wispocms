import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { encryptionKey } from '../ai/ai-secret';
import { decryptSocialSecret, encryptSocialSecret } from './social-api';

export type SocialNetwork = 'youtube' | 'instagram';
export type SocialSettingsRow = {
  network: SocialNetwork;
  encrypted_secret: string | null;
  app_id: string | null;
  redirect_uri: string | null;
  revision: number;
};
export const INSTAGRAM_CALLBACK = '/api/social/instagram/callback';
export function socialNetwork(value: string): SocialNetwork {
  if (value !== 'youtube' && value !== 'instagram')
    throw new BadRequestException('Неизвестная социальная сеть');
  return value;
}
export function validateInstagramRedirect(value: string): string {
  try {
    const uri = new URL(value);
    const origins = (process.env.WEB_ORIGIN ?? '')
      .split(',')
      .map((item) => item.trim());
    if (
      uri.protocol !== 'https:' ||
      uri.username ||
      uri.password ||
      uri.search ||
      uri.hash ||
      uri.pathname !== INSTAGRAM_CALLBACK ||
      !origins.includes(uri.origin)
    )
      throw new Error();
    return uri.href;
  } catch {
    throw new BadRequestException(
      'Redirect URI должен совпадать с HTTPS-доменом CMS и оканчиваться на /api/social/instagram/callback.',
    );
  }
}

@Injectable()
export class PlatformSocialSettingsService {
  constructor(private readonly db: DataSource) {}
  async row(network: SocialNetwork): Promise<SocialSettingsRow> {
    const [row] = await this.db.query<SocialSettingsRow[]>(
      'SELECT network,encrypted_secret,app_id,redirect_uri,revision FROM platform_social_settings WHERE network=$1',
      [network],
    );
    if (!row)
      throw new ServiceUnavailableException('Настройки интеграции недоступны');
    return row;
  }
  async status(network: SocialNetwork) {
    const row = await this.row(network);
    let storageReady = false;
    try {
      encryptionKey();
      storageReady = true;
    } catch {
      /* fail closed */
    }
    return {
      configured: Boolean(row.encrypted_secret) && storageReady,
      hasKey: Boolean(row.encrypted_secret),
      storageReady,
      appId: row.app_id ?? '',
      redirectUri: row.redirect_uri ?? '',
      revision: row.revision,
    };
  }
  async save(
    network: SocialNetwork,
    input: {
      secret: string;
      revision: number;
      appId?: string;
      redirectUri?: string;
    },
    actorId: string,
  ) {
    const secret = input.secret.trim();
    if (!/^[A-Za-z0-9_.-]{16,4096}$/.test(secret))
      throw new BadRequestException(
        'Введите корректный ключ приложения без пробелов.',
      );
    if (network === 'instagram' && !/^\d{5,32}$/.test(input.appId ?? ''))
      throw new BadRequestException('Введите Instagram App ID.');
    const redirect =
      network === 'instagram'
        ? validateInstagramRedirect(input.redirectUri ?? '')
        : null;
    const rows = await this.db.query<Array<{ revision: number }>>(
      `WITH changed AS (UPDATE platform_social_settings SET encrypted_secret=$1,app_id=$2,redirect_uri=$3,revision=revision+1,updated_at=now(),updated_by=$4 WHERE network=$5 AND revision=$6 RETURNING revision) SELECT revision FROM changed`,
      [
        encryptSocialSecret(secret, `platform:${network}`),
        network === 'instagram' ? input.appId : null,
        redirect,
        actorId,
        network,
        input.revision,
      ],
    );
    if (!rows.length)
      throw new ConflictException('Настройки изменились. Обновите страницу.');
    return this.status(network);
  }
  async remove(network: SocialNetwork, revision: number, actorId: string) {
    const rows = await this.db.query<Array<{ revision: number }>>(
      'WITH changed AS (UPDATE platform_social_settings SET encrypted_secret=NULL,revision=revision+1,updated_at=now(),updated_by=$1 WHERE network=$2 AND revision=$3 RETURNING revision) SELECT revision FROM changed',
      [actorId, network, revision],
    );
    if (!rows.length)
      throw new ConflictException('Настройки изменились. Обновите страницу.');
    return this.status(network);
  }
  async credentials(network: SocialNetwork) {
    const row = await this.row(network);
    if (!row.encrypted_secret)
      throw new ServiceUnavailableException(
        `Администратор CMS должен настроить ${network === 'youtube' ? 'YouTube Data API' : 'приложение Instagram'} в настройках платформы.`,
      );
    return {
      ...row,
      secret: decryptSocialSecret(row.encrypted_secret, `platform:${network}`),
    };
  }
}
