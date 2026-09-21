import { Injectable } from '@nestjs/common';
import type { SitePage } from './site-crawler';
import { object, text, socialJson, SocialSourceError } from './social-api';
import { youtubeChannel } from './social-address';

@Injectable()
export class YoutubeSourceClient {
  async call(
    method: 'channels' | 'playlistItems' | 'videos',
    key: string,
    params: Record<string, string>,
    signal: AbortSignal,
  ) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${method}`);
    url.search = new URLSearchParams({ ...params, key }).toString();
    return socialJson(url, {}, signal);
  }
  async collect(key: string, sourceUrl: string, parentSignal: AbortSignal) {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(90_000)]);
    const target = youtubeChannel(sourceUrl);
    const result = await this.call(
      'channels',
      key,
      { part: 'snippet,contentDetails', [target.key]: target.value },
      signal,
    );
    if (!Array.isArray(result.items) || result.items.length !== 1)
      throw new SocialSourceError('Канал YouTube не найден. Проверьте адрес.');
    const channel = object(result.items[0]);
    const id = text(channel.id);
    const snippet = object(channel.snippet);
    const uploads = text(
      object(object(channel.contentDetails).relatedPlaylists).uploads,
    );
    if (
      !/^UC[\w-]{22}$/.test(id) ||
      !/^[\w-]{1,100}$/.test(uploads) ||
      !text(snippet.title)
    )
      throw new SocialSourceError('YouTube вернул неполное описание канала.');
    const pages: SitePage[] = [
      {
        url: `https://www.youtube.com/channel/${id}`,
        title: `Канал «${text(snippet.title)}»`,
        group: 'YouTube',
        status: 'loaded',
        recommended: true,
        content: [text(snippet.title), text(snippet.description)]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
    const warnings = [
      'До 100 последних видео без ограничения по давности. Сбор сохраняет названия и описания; аудио можно отдельно поставить в очередь Groq Whisper. Комментарии не собираются.',
    ];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    let cursor = '';
    let bytes = pages[0].content!.length;
    for (let batch = 0; batch < 5; batch++) {
      signal.throwIfAborted();
      const response = await this.call(
        'playlistItems',
        key,
        {
          part: 'contentDetails',
          playlistId: uploads,
          maxResults: '50',
          ...(cursor ? { pageToken: cursor } : {}),
        },
        signal,
      );
      if (!Array.isArray(response.items) || response.items.length > 50)
        throw new SocialSourceError('YouTube вернул неполный список видео.');
      const ids = response.items.map((item) =>
        text(object(object(item).contentDetails).videoId),
      );
      if (ids.some((videoId) => !/^[\w-]{11}$/.test(videoId)))
        throw new SocialSourceError('YouTube вернул некорректный адрес видео.');
      const fresh = [...new Set(ids)]
        .filter((videoId) => !seen.has(videoId))
        .slice(0, 100 - seen.size);
      if (fresh.length) {
        const videos = await this.call(
          'videos',
          key,
          { part: 'snippet,status', id: fresh.join(',') },
          signal,
        );
        if (!Array.isArray(videos.items))
          throw new SocialSourceError('Не удалось получить описания YouTube.');
        for (const videoId of fresh) {
          seen.add(videoId);
          const video = object(
            videos.items.find((item) => object(item).id === videoId),
          );
          const details = object(video.snippet);
          const page: SitePage = {
            url: `https://www.youtube.com/watch?v=${videoId}`,
            title: text(details.title) || 'Недоступное видео',
            group: 'YouTube',
            recommended: true,
            status: 'failed',
          };
          if (
            details.channelId !== id ||
            object(video.status).privacyStatus !== 'public' ||
            !text(details.title) ||
            !Number.isFinite(Date.parse(text(details.publishedAt)))
          ) {
            page.error =
              'Видео удалено, недоступно или не принадлежит выбранному каналу.';
          } else {
            page.status = 'loaded';
            page.content = `Дата публикации: ${text(details.publishedAt)}\nНазвание: ${text(details.title)}\n\n${text(details.description) || 'Описание отсутствует.'}\n\nПрочитано только описание; содержание видео не просмотрено.`;
            bytes += page.content.length;
            if (bytes > 700_000)
              throw new SocialSourceError(
                'Описания YouTube превышают лимит одного сбора. Предыдущий снимок сохранён.',
              );
          }
          pages.push(page);
        }
      }
      cursor = text(response.nextPageToken);
      if (!cursor) break;
      if (seen.size >= 100 || batch === 4) {
        warnings.push(
          'Достигнут предел выборки; более старые видео не проверены.',
        );
        break;
      }
      if (cursor.length > 2048 || cursors.has(cursor))
        throw new SocialSourceError(
          'YouTube повторил страницу списка. Сбор остановлен.',
        );
      cursors.add(cursor);
    }
    return { pages, warnings };
  }
}
