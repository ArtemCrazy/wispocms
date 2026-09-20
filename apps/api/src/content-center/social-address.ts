import { BadRequestException } from '@nestjs/common';

const hosts = {
  youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
  instagram: ['instagram.com', 'www.instagram.com'],
};
export function isSocialUrl(
  value: string | null | undefined,
  network: keyof typeof hosts,
): boolean {
  try {
    return hosts[network].includes(new URL(value ?? '').hostname);
  } catch {
    return false;
  }
}
function address(value: string, network: keyof typeof hosts): URL {
  try {
    const url = new URL(value);
    if (
      !isSocialUrl(value, network) ||
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      throw new Error();
    decodeURIComponent(url.pathname);
    return url;
  } catch {
    throw new BadRequestException(
      'Укажите HTTPS-адрес профиля без параметров, логина и пароля.',
    );
  }
}
export function instagramUsername(value: string): string {
  const url = address(value, 'instagram');
  const match = /^\/([a-zA-Z0-9_.]{1,30})\/?$/.exec(url.pathname);
  if (
    !match ||
    /^(p|reel|reels|stories|explore|accounts|direct|about|developer|developers|legal|web)$/i.test(
      match[1],
    )
  )
    throw new BadRequestException(
      'Укажите профиль Instagram, а не ссылку на публикацию.',
    );
  return match[1].toLowerCase();
}
export function youtubeChannel(value: string): {
  key: 'id' | 'forHandle' | 'forUsername';
  value: string;
} {
  const url = address(value, 'youtube');
  const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
  if (url.hostname !== 'youtu.be') {
    if (/^\/@[^/\s?#]{3,100}$/u.test(path))
      return { key: 'forHandle', value: path.slice(1) };
    if (/^\/channel\/UC[\w-]{22}$/.test(path))
      return { key: 'id', value: path.slice(9) };
    if (/^\/user\/[a-zA-Z0-9_.-]{1,100}$/.test(path))
      return { key: 'forUsername', value: path.slice(6) };
  }
  throw new BadRequestException(
    'Укажите канал YouTube: youtube.com/@имя или youtube.com/channel/UC…. Ссылки на видео и /c/ не поддерживаются.',
  );
}
