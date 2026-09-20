import { BadRequestException } from '@nestjs/common';
import { load } from 'cheerio';
import { setTimeout as delay } from 'node:timers/promises';
import { readPublicResource } from './public-material';
import type { SitePage } from './site-crawler';

const HOSTS = new Set(['t.me', 'www.t.me', 'telegram.me', 'www.telegram.me']);
export const TELEGRAM_POST_LIMIT = 100;
export const TELEGRAM_PERIOD_DAYS = 180;

export function isTelegramUrl(value: string | null | undefined): boolean {
  try {
    return HOSTS.has(new URL(value ?? '').hostname);
  } catch {
    return false;
  }
}

export function telegramChannel(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(
      'Укажите HTTPS-ссылку на публичный Telegram-канал',
    );
  }
  const match = /^\/(?:s\/)?([a-zA-Z][a-zA-Z0-9_]{3,31})\/?$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== 'https:' ||
    !HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !match ||
    /^(joinchat|share|proxy|socks|addstickers|addemoji|login|iv|boost|contact)$/i.test(
      match[1],
    )
  )
    throw new BadRequestException(
      'Укажите ссылку на публичный канал, не на пост, чат по приглашению или бота',
    );
  return match[1].toLowerCase();
}

export class TelegramSourceError extends Error {}

export function parseTelegramPreview(html: string, channel: string) {
  const $ = load(html);
  $('script,style,noscript,svg').remove();
  const text = (selector: string) => $(selector).first().text().trim();
  const posts = $('.tgme_widget_message[data-post]')
    .toArray()
    .map((element) => {
      const node = $(element);
      const [owner, id, extra] = (node.attr('data-post') ?? '').split('/');
      if (
        owner?.toLowerCase() !== channel ||
        extra ||
        !/^\d+$/.test(id ?? '') ||
        !Number.isSafeInteger(Number(id)) ||
        Number(id) <= 0
      )
        throw new TelegramSourceError(
          'Telegram вернул публикации другого источника или некорректные адреса.',
        );
      const date = node.find('time[datetime]').first().attr('datetime');
      const published = date ? new Date(date) : null;
      if (!published || !Number.isFinite(published.getTime()))
        throw new TelegramSourceError(
          'Telegram не передал дату публикации. Сбор остановлен.',
        );
      const body = node.find('.tgme_widget_message_text').first().clone();
      body.find('br').replaceWith('\n');
      body.find('p,div,blockquote').append('\n');
      // Custom emoji may have no text node; preserve their accessible text.
      body.find('img[alt]').each((_, image) => {
        $(image).replaceWith($(image).attr('alt') ?? '');
      });
      return {
        id: Number(id),
        date: published,
        content: body
          .text()
          .replace(/\r/g, '')
          .replace(/[ \t]+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim(),
        forwarded: node.find('.tgme_widget_message_forwarded_from').length > 0,
      };
    })
    .sort((a, b) => b.id - a.id);
  const more = $('a.tme_messages_more[data-before]')
    .first()
    .attr('data-before');
  if (more && (!/^\d+$/.test(more) || !Number.isSafeInteger(Number(more))))
    throw new TelegramSourceError(
      'Telegram вернул некорректную следующую страницу.',
    );
  return {
    title: text('.tgme_channel_info_header_title') || channel,
    description: text('.tgme_channel_info_description'),
    posts,
    before: more ? Number(more) : null,
  };
}

export class TelegramSourceClient {
  async collect(
    sourceUrl: string,
    signal: AbortSignal,
    now = new Date(),
  ): Promise<{ pages: SitePage[]; warnings: string[] }> {
    const channel = telegramChannel(sourceUrl);
    const url = `https://t.me/${channel}`;
    const pages: SitePage[] = [];
    const warnings = [
      `Последние ${TELEGRAM_POST_LIMIT} публикаций за ${TELEGRAM_PERIOD_DAYS} дней из публичной веб-ленты. Репосты, комментарии и содержимое вложений не включаются. Это не полный архив канала.`,
    ];
    const seen = new Set<number>();
    const dates: Date[] = [];
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
    const cutoff = now.getTime() - TELEGRAM_PERIOD_DAYS * 86400000;
    let before: number | null = null;
    let complete = false;
    let characters = 0;
    try {
      for (let batch = 0; batch < 10; batch++) {
        deadline.throwIfAborted();
        const address = `https://t.me/s/${channel}${before ? `?before=${before}` : ''}`;
        const resource = await readPublicResource(address, {
          signal: deadline,
          beforeRequest: (target) => {
            // Do not follow login, external, private-chat or other-channel redirects.
            if (
              target.origin !== 'https://t.me' ||
              target.pathname !== `/s/${channel}` ||
              target.search !== (before ? `?before=${before}` : '')
            )
              throw new TelegramSourceError(
                'Публичная веб-лента канала недоступна. Проверьте ссылку или добавьте текст вручную.',
              );
          },
        });
        if (!resource.html)
          throw new TelegramSourceError(
            'Telegram не вернул публичную веб-ленту.',
          );
        const preview = parseTelegramPreview(resource.body, channel);
        if (!preview.posts.length)
          throw new TelegramSourceError(
            'Публикации в публичной веб-ленте не найдены. Канал может быть пустым, закрытым или недоступным без входа.',
          );
        if (!batch && preview.description) {
          pages.push({
            url,
            title: `Описание канала «${preview.title}»`,
            group: 'Telegram',
            status: 'loaded',
            recommended: true,
            content: preview.description,
            checkedAt: now.toISOString(),
          });
          characters += preview.description.length;
        }
        let added = 0;
        let limited = false;
        for (const post of preview.posts) {
          if (seen.has(post.id)) continue;
          if (post.date.getTime() > now.getTime() + 86400000)
            throw new TelegramSourceError(
              'Telegram вернул некорректную дату публикации.',
            );
          if (post.date.getTime() < cutoff) {
            complete = true;
            continue;
          }
          if (seen.size >= TELEGRAM_POST_LIMIT) {
            limited = true;
            break;
          }
          const included = !post.forwarded && Boolean(post.content);
          characters += included ? post.content.length : 0;
          if (characters > 1_200_000)
            throw new TelegramSourceError(
              'Достигнут безопасный объём текста одного сбора. Получена только часть публикаций.',
            );
          seen.add(post.id);
          added++;
          dates.push(post.date);
          pages.push({
            url: `${url}/${post.id}`,
            title: `${post.date.toLocaleDateString('ru-RU', { timeZone: 'UTC' })} · ${post.forwarded ? 'Репост' : post.content.slice(0, 90).replace(/\s+/g, ' ') || 'Публикация без текста'}`,
            group: 'Публикации Telegram',
            recommended: included,
            status: included ? 'loaded' : 'found',
            checkedAt: now.toISOString(),
            content: included
              ? `Дата публикации: ${post.date.toISOString()}. Условия предложения могли измениться.\n\n${post.content}`
              : undefined,
            reason: post.forwarded
              ? 'Репост — не включён'
              : !post.content
                ? 'Текст отсутствует; вложения не прочитаны'
                : 'Текст собственной публикации в выбранном периоде',
          });
        }
        if (limited) {
          complete = false;
          break;
        }
        if (complete || !preview.before) {
          complete = true;
          break;
        }
        if (seen.size >= TELEGRAM_POST_LIMIT) break;
        if (!added || (before !== null && preview.before >= before))
          throw new TelegramSourceError(
            'Telegram повторяет страницу ленты. Сбор остановлен, получена только часть публикаций.',
          );
        before = preview.before;
        await delay(400, undefined, { signal: deadline });
      }
      if (!complete)
        warnings.push(
          `Достигнут лимит выборки: проверено ${seen.size} публикаций. Более старые записи не проверены.`,
        );
    } catch (error) {
      signal.throwIfAborted();
      const message =
        error instanceof TelegramSourceError
          ? error.message
          : 'Telegram недоступен или ограничил запросы. Повторите сбор позже.';
      if (!pages.length) throw new TelegramSourceError(message);
      warnings.push(message);
      pages.push({
        url,
        title: 'Лента Telegram — сбор прерван',
        group: 'Telegram',
        status: 'failed',
        recommended: true,
        error: message,
        checkedAt: now.toISOString(),
      });
    }
    if (dates.length) {
      const values = dates.map((date) => date.getTime());
      warnings.push(
        `Проверено публикаций: ${seen.size}. Период полученной выборки: ${new Date(Math.min(...values)).toLocaleDateString('ru-RU', { timeZone: 'UTC' })} — ${new Date(Math.max(...values)).toLocaleDateString('ru-RU', { timeZone: 'UTC' })}.`,
      );
    } else warnings.push('Публикаций за выбранный период не найдено.');
    return { pages, warnings };
  }
}
