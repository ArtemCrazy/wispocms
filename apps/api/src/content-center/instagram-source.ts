import { Injectable } from '@nestjs/common';
import { object, text, socialJson, SocialSourceError } from './social-api';
import type { SitePage } from './site-crawler';

const API = 'https://graph.instagram.com/v23.0/';
function tokenResult(data: Record<string, unknown>) {
  const token = text(data.access_token);
  const seconds = Number(data.expires_in);
  if (
    !/^[A-Za-z0-9_.-]{16,4096}$/.test(token) ||
    !Number.isSafeInteger(seconds) ||
    seconds < 60 ||
    seconds > 90 * 86400
  )
    throw new SocialSourceError(
      'Instagram не выдал действующий долгосрочный доступ. Повторите подключение.',
    );
  return { token, expiresAt: new Date(Date.now() + seconds * 1000) };
}
@Injectable()
export class InstagramSourceClient {
  async exchange(
    code: string,
    appId: string,
    secret: string,
    redirect: string,
    signal: AbortSignal,
  ) {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      client_id: appId,
      client_secret: secret,
      grant_type: 'authorization_code',
      redirect_uri: redirect,
      code,
    }))
      form.set(key, value);
    const short = await socialJson(
      'https://api.instagram.com/oauth/access_token',
      { method: 'POST', body: form },
      signal,
    );
    const token = text(short.access_token);
    if (!/^[A-Za-z0-9_.-]{16,4096}$/.test(token))
      throw new SocialSourceError(
        'Instagram не выдал доступ. Проверьте разрешения приложения.',
      );
    const uri = new URL('https://graph.instagram.com/access_token');
    uri.search = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: secret,
      access_token: token,
    }).toString();
    return tokenResult(await socialJson(uri, {}, signal));
  }
  async refresh(token: string, signal: AbortSignal) {
    const uri = new URL('https://graph.instagram.com/refresh_access_token');
    uri.search = new URLSearchParams({
      grant_type: 'ig_refresh_token',
      access_token: token,
    }).toString();
    return tokenResult(await socialJson(uri, {}, signal));
  }
  async call(
    path: string,
    token: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ) {
    if (!/^(me|\d+(\/media)?)$/.test(path))
      throw new SocialSourceError('Некорректный идентификатор Instagram.');
    const uri = new URL(path, API);
    uri.search = new URLSearchParams(params).toString();
    return socialJson(
      uri,
      { headers: { Authorization: `Bearer ${token}` } },
      signal,
    );
  }
  async profile(token: string, signal: AbortSignal) {
    const profile = await this.call(
      'me',
      token,
      { fields: 'user_id,username' },
      signal,
    );
    const id = text(profile.user_id) || text(profile.id);
    const username = text(profile.username).toLowerCase();
    if (!/^\d{5,32}$/.test(id) || !/^[a-z0-9_.]{1,30}$/.test(username))
      throw new SocialSourceError(
        'Instagram не подтвердил профессиональный профиль.',
      );
    return { id, username };
  }
  async collect(
    token: string,
    accountId: string,
    username: string,
    parentSignal: AbortSignal,
  ) {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(90_000)]);
    const profile = await this.profile(token, signal);
    if (profile.id !== accountId || profile.username !== username)
      throw new SocialSourceError(
        'Профиль Instagram изменился. Проверьте адрес и подключите источник заново.',
      );
    const pages: SitePage[] = [
      {
        url: `https://www.instagram.com/${username}/`,
        title: `Instagram · ${username}`,
        group: 'Instagram',
        recommended: true,
        status: 'loaded',
        content: `Профессиональный аккаунт Instagram: @${username}. Доступ к собственным публикациям предоставлен владельцем.`,
      },
    ];
    const warnings = [
      'До 100 последних публикаций без ограничения по давности. Читаются только подписи и даты. Фото, видео, звук, Stories, переписка и комментарии не читаются.',
    ];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor = '';
    let size = 0;
    for (let batch = 0; batch < 5; batch++) {
      const data = await this.call(
        `${accountId}/media`,
        token,
        {
          fields: 'id,caption,media_type,permalink,timestamp',
          limit: '50',
          ...(cursor ? { after: cursor } : {}),
        },
        signal,
      );
      if (!Array.isArray(data.data) || data.data.length > 50)
        throw new SocialSourceError(
          'Instagram вернул неполный список публикаций.',
        );
      for (const item of data.data) {
        const post = object(item);
        const id = text(post.id);
        if (
          !/^\d{5,32}$/.test(id) ||
          !Number.isFinite(Date.parse(text(post.timestamp)))
        )
          throw new SocialSourceError('Instagram вернул неполную публикацию.');
        if (seen.has(id)) continue;
        seen.add(id);
        const link = text(post.permalink);
        if (
          !/^https:\/\/(www\.)?instagram\.com\/(p|reel)\/[\w-]+\/?$/.test(link)
        )
          throw new SocialSourceError(
            'Instagram вернул некорректную ссылку публикации.',
          );
        const caption = text(post.caption).trim();
        size += caption.length;
        if (size > 700_000)
          throw new SocialSourceError(
            'Тексты Instagram превышают лимит одного сбора. Предыдущий снимок сохранён.',
          );
        pages.push({
          url: link,
          title: caption ? caption.slice(0, 100) : 'Публикация без подписи',
          group: 'Instagram',
          status: caption ? 'loaded' : 'found',
          recommended: Boolean(caption),
          ...(caption
            ? {
                content: `Дата публикации: ${text(post.timestamp)}\nТип: ${text(post.media_type)}\n\n${caption}`,
              }
            : {
                reason:
                  'Нет текстовой подписи. Изображение или видео не прочитано.',
              }),
        });
        if (seen.size === 100) break;
      }
      const paging = object(data.paging);
      cursor = text(object(paging.cursors).after);
      if (!paging.next) break;
      if (seen.size >= 100 || batch === 4) {
        warnings.push(
          'Достигнут предел выборки; более старые публикации не проверены.',
        );
        break;
      }
      if (!cursor || cursor.length > 2048 || cursors.has(cursor))
        throw new SocialSourceError(
          'Instagram повторил страницу списка. Сбор остановлен.',
        );
      cursors.add(cursor);
      // Deliberately ignore paging.next URL: reconstruct a fixed-host request.
    }
    return { pages, warnings };
  }
}
