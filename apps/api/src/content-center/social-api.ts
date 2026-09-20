import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { encryptionKey } from '../ai/ai-secret';

export class SocialSourceError extends Error {}
export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';

// All callers construct URLs from fixed API hosts. Never follow provider redirects
// or return provider error bodies: they may repeat credentials.
export async function socialJson(
  url: URL | string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok || !response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4 * 1024 * 1024) throw new Error();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const data = object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (data.error || !Object.keys(data).length) throw new Error();
    return data;
  } catch {
    signal.throwIfAborted();
    throw new SocialSourceError(
      'Сервис не разрешил запрос или временно недоступен. Проверьте подключение, права и квоту API. Предыдущий сбор сохранён.',
    );
  }
}

export function encryptSocialSecret(value: string, purpose: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`wispo:social:v1:${purpose}`));
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((part) => part.toString('base64'))
    .join('.');
}
export function decryptSocialSecret(value: string, purpose: string): string {
  try {
    const [iv, tag, data, extra] = value.split('.');
    if (!iv || !tag || !data || extra) throw new Error();
    const cipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64'),
    );
    cipher.setAAD(Buffer.from(`wispo:social:v1:${purpose}`));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(data, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SocialSourceError(
      'Не удалось прочитать ключ подключения. Подключите источник заново.',
    );
  }
}
