import { BadRequestException, Injectable } from '@nestjs/common';
import { setTimeout as delay } from 'node:timers/promises';
import type { SitePage } from './site-crawler';

const VK_HOSTS = new Set([
  'vk.com',
  'www.vk.com',
  'm.vk.com',
  'vk.ru',
  'www.vk.ru',
  'm.vk.ru',
]);
export const VK_POST_LIMIT = 500;
export const VK_PERIOD_DAYS = 180;

export function isVkUrl(value: string | null | undefined): boolean {
  try {
    return VK_HOSTS.has(new URL(value ?? '').hostname);
  } catch {
    return false;
  }
}

export function vkCommunityAddress(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Введите HTTPS-ссылку на сообщество VK');
  }
  const address = url.pathname.replace(/^\/|\/$/g, '');
  if (
    url.protocol !== 'https:' ||
    !VK_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^[a-zA-Z0-9_.]{2,100}$/.test(address) ||
    /^(id\d+|wall|feed|im|video|photo|clip|join|away)(\b|\d|_)/i.test(address)
  )
    throw new BadRequestException(
      'Укажите адрес сообщества VK, а не профиля, поста или видео',
    );
  return address;
}

export class VkSourceError extends Error {}
type VkObject = Record<string, unknown>;
const record = (value: unknown): VkObject =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as VkObject)
    : {};
const string = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export type VkCommunity = {
  id: number;
  name: string;
  description: string;
  status: string;
  site: string;
};
export type VkPost = {
  id: number;
  owner_id: number;
  from_id: number;
  date: number;
  text: string;
  is_pinned?: number;
  copy_history?: unknown[];
  attachments?: unknown[];
};

@Injectable()
export class VkSourceClient {
  async call(
    method: 'groups.getById' | 'wall.get',
    token: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      const response = await fetch(`https://api.vk.com/method/${method}`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          ...params,
          access_token: token,
          v: '5.199',
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (!response.ok || !response.body)
        throw new VkSourceError(
          'VK временно недоступен. Повторите сбор позже.',
        );
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 4 * 1024 * 1024)
            throw new VkSourceError(
              'Ответ VK слишком большой. Сбор остановлен.',
            );
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      const data = record(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (data.error) {
        const code = record(data.error).error_code;
        if (code === 5 || code === 27 || code === 28)
          throw new VkSourceError(
            'Ключ VK недействителен или отозван. Подключите сообщество заново.',
          );
        if (code === 6 || code === 9 || code === 29)
          throw new VkSourceError(
            'VK ограничил частоту запросов. Повторите сбор позже.',
          );
        throw new VkSourceError(
          'VK не разрешил чтение сообщества. Проверьте тип ключа и права доступа.',
        );
      }
      if (!('response' in data))
        throw new VkSourceError(
          'VK вернул неполный ответ. Повторите сбор позже.',
        );
      return data.response;
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof VkSourceError) throw error;
      // Provider errors can echo access_token/request_params. Never expose or log them.
      throw new VkSourceError(
        'Не удалось получить ответ VK. Проверьте подключение и повторите сбор.',
      );
    }
  }

  async community(
    token: string,
    sourceUrl: string,
    signal: AbortSignal,
    requireAdmin = true,
  ): Promise<VkCommunity> {
    const data = await this.call(
      'groups.getById',
      token,
      {
        group_ids: vkCommunityAddress(sourceUrl),
        fields: 'description,status,site',
      },
      signal,
    );
    const groups = Array.isArray(data) ? data : record(data).groups;
    const group = record(Array.isArray(groups) ? groups[0] : undefined);
    if (!Number.isSafeInteger(group.id) || Number(group.id) <= 0)
      throw new VkSourceError(
        'Открытое сообщество VK не найдено. Проверьте ссылку.',
      );
    if (requireAdmin && group.is_admin !== 1)
      throw new VkSourceError(
        'Старое подключение VK больше не подтверждает права администратора. Подключите источник заново через общее подключение CMS.',
      );
    if (group.is_closed !== 0)
      throw new VkSourceError(
        'Первая версия поддерживает только открытые сообщества заказчика.',
      );
    return {
      id: Number(group.id),
      name: string(group.name),
      description: string(group.description),
      status: string(group.status),
      site: string(group.site),
    };
  }

  async posts(
    token: string,
    groupId: number,
    offset: number,
    signal: AbortSignal,
    count = 100,
  ): Promise<{ count: number; items: VkPost[] }> {
    const data = record(
      await this.call(
        'wall.get',
        token,
        {
          owner_id: String(-groupId),
          filter: 'owner',
          count: String(count),
          offset: String(offset),
        },
        signal,
      ),
    );
    if (
      !Number.isSafeInteger(data.count) ||
      Number(data.count) < 0 ||
      !Array.isArray(data.items) ||
      data.items.length > count
    )
      throw new VkSourceError('VK вернул неполный список публикаций.');
    const items = data.items.map((item) => {
      const post = record(item);
      if (
        !Number.isSafeInteger(post.id) ||
        Number(post.id) <= 0 ||
        post.owner_id !== -groupId ||
        !Number.isSafeInteger(post.from_id) ||
        !Number.isSafeInteger(post.date) ||
        typeof post.text !== 'string' ||
        (post.copy_history !== undefined &&
          !Array.isArray(post.copy_history)) ||
        (post.attachments !== undefined && !Array.isArray(post.attachments))
      )
        throw new VkSourceError(
          'VK вернул некорректную публикацию. Сбор остановлен.',
        );
      return post as VkPost;
    });
    return { count: Number(data.count), items };
  }

  async collect(
    token: string,
    community: VkCommunity,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<{ pages: SitePage[]; warnings: string[] }> {
    const cutoff = now.getTime() - VK_PERIOD_DAYS * 86_400_000;
    const pages: SitePage[] = [
      {
        url: `https://vk.com/club${community.id}`,
        title: community.name || 'Сообщество VK',
        group: 'О сообществе',
        recommended: true,
        status: 'loaded',
        checkedAt: now.toISOString(),
        content: [
          `Сообщество: ${community.name}`,
          community.description,
          community.status,
          community.site ? `Сайт: ${community.site}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        reason: 'Описание сообщества заказчика',
      },
    ];
    const warnings = [
      `Текстовые публикации сообщества за последние ${VK_PERIOD_DAYS} дней и закреплённое сообщение. До ${VK_POST_LIMIT} записей за сбор. Комментарии, личные сообщения, изображения и содержимое видео не анализировались.`,
    ];
    const seen = new Set<number>();
    const texts = new Set<string>();
    let chars = pages[0].content!.length;
    try {
      for (let offset = 0; offset < VK_POST_LIMIT; offset += 100) {
        await delay(400, undefined, { signal });
        const batch = await this.posts(token, community.id, offset, signal);
        let reachedPeriod = false;
        for (const post of batch.items) {
          if (seen.has(post.id)) continue;
          seen.add(post.id);
          const date = new Date(post.date * 1000);
          if (!Number.isFinite(date.getTime()))
            throw new VkSourceError('В публикации VK некорректная дата.');
          if (!post.is_pinned && date.getTime() < cutoff) {
            reachedPeriod = true;
            continue;
          }
          const content = post.text.trim();
          const owned =
            post.from_id === -community.id && !post.copy_history?.length;
          const duplicate = content && texts.has(content);
          const recommended = owned && Boolean(content) && !duplicate;
          if (chars + content.length > 700_000) {
            warnings.push(
              'Достигнут предел объёма одного сбора VK. Остальные публикации не получены.',
            );
            return { pages, warnings };
          }
          chars += content.length;
          if (recommended) texts.add(content);
          pages.push({
            url: `https://vk.com/wall-${community.id}_${post.id}`,
            title: `${post.is_pinned ? 'Закреплённое · ' : ''}${date.toLocaleDateString('ru-RU', { timeZone: 'UTC' })} · ${content.slice(0, 90).replace(/\s+/g, ' ') || 'Публикация без текста'}`,
            group: 'Публикации VK',
            recommended,
            status:
              !owned || !content ? 'found' : duplicate ? 'duplicate' : 'loaded',
            checkedAt: now.toISOString(),
            content:
              owned && content
                ? `Дата публикации: ${date.toISOString()}. Это дата сообщения, не подтверждение актуальности предложения.\n\n${content}${post.attachments?.length ? '\n\nВложения не прочитаны.' : ''}`
                : undefined,
            reason: !owned
              ? 'Репост или запись другого автора — не включены'
              : !content
                ? 'Только вложения: текст отсутствует'
                : duplicate
                  ? 'Повтор текста другой публикации'
                  : 'Собственная текстовая публикация в выбранном периоде; актуальность условий нужно проверять по дате',
          });
        }
        if (
          reachedPeriod ||
          batch.items.length < 100 ||
          offset + batch.items.length >= batch.count
        )
          return { pages, warnings };
      }
      warnings.push(
        `Проверены первые ${VK_POST_LIMIT} записей. Более старые публикации могли остаться за пределами выборки.`,
      );
    } catch (error) {
      signal.throwIfAborted();
      const message =
        error instanceof VkSourceError
          ? error.message
          : 'Сбор VK прерван. Получена только часть публикаций.';
      warnings.push(message);
      pages.push({
        url: `https://vk.com/club${community.id}`,
        title: 'Лента публикаций — сбор прерван',
        group: 'Публикации VK',
        status: 'failed',
        recommended: true,
        error: message,
        checkedAt: now.toISOString(),
      });
    }
    return { pages, warnings };
  }
}
