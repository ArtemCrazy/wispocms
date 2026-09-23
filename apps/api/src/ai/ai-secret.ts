import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export function encryptionKey(): Buffer {
  const value = process.env.AI_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new ServiceUnavailableException(
      'Серверное хранилище ключей не настроено. Обратитесь к администратору сервера.',
    );
  return Buffer.from(value, 'hex');
}

export function encryptApiKey(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from('wispo:deepseek:v1'));
  const encrypted = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptApiKey(value: string): string {
  try {
    const [version, iv, tag, data, extra] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAAD(Buffer.from('wispo:deepseek:v1'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException(
      'Не удалось прочитать ключ DeepSeek. Проверьте серверное хранилище ключей.',
    );
  }
}
