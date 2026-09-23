import {
  TelegramSourceClient,
  telegramChannel,
  parseTelegramPreview,
} from './telegram-source';
import * as publicMaterial from './public-material';

const now = new Date('2026-09-20T12:00:00Z');
const post = (
  id: number,
  content = 'Услуги<br>Новая строка &amp; детали',
  options: { forwarded?: boolean; date?: string; owner?: string } = {},
) =>
  `<div class="tgme_widget_message" data-post="${options.owner ?? 'customer'}/${id}"><time datetime="${options.date ?? '2026-09-19T12:00:00Z'}"></time>${options.forwarded ? '<div class="tgme_widget_message_forwarded_from">Другой автор</div>' : ''}<div class="tgme_widget_message_text">${content}</div></div>`;
const html = (posts: string, before?: number) =>
  `<div class="tgme_channel_info_header_title">Компания</div><div class="tgme_channel_info_description">Описание компании</div>${posts}${before ? `<a class="tme_messages_more" data-before="${before}" href="/s/customer?before=${before}">Earlier</a>` : ''}`;
const result = (body: string) => ({
  body,
  html: true,
  url: 'https://t.me/s/customer',
  status: 200,
});

describe('Telegram public channel collection', () => {
  afterEach(() => jest.restoreAllMocks());

  it('validates channel-only HTTPS URLs and normalizes aliases', () => {
    expect(telegramChannel('https://telegram.me/Customer/')).toBe('customer');
    expect(telegramChannel('https://t.me/s/customer')).toBe('customer');
    for (const value of [
      'http://t.me/customer',
      'https://t.me.evil.org/customer',
      'https://user:pass@t.me/customer',
      'https://t.me:444/customer',
      'https://t.me/+secret',
      'https://t.me/c/123/4',
      'https://t.me/customer/12',
      'https://t.me/customer?before=1',
      'https://t.me/customer#x',
      'https://t.me/share',
      'https://t.me/proxy',
      'https://t.me/joinchat/secret',
    ])
      expect(() => telegramChannel(value)).toThrow();
  });

  it('parses only post text, preserves line breaks and excludes scripts/navigation', () => {
    const parsed = parseTelegramPreview(
      html(
        post(
          10,
          '<b>Услуги</b><br>Цена &amp; описание<script>evil()</script>',
        ) + post(9, '', { forwarded: true }),
        9,
      ),
      'customer',
    );
    expect(parsed.posts[0].content).toBe('Услуги\nЦена & описание');
    expect(parsed.posts[1].forwarded).toBe(true);
    expect(parsed.before).toBe(9);
    expect(() =>
      parseTelegramPreview(
        html(post(2, 'text', { owner: 'other' })),
        'customer',
      ),
    ).toThrow('другого источника');
    expect(() =>
      parseTelegramPreview(html(post(2, 'text', { date: 'bad' })), 'customer'),
    ).toThrow('дату');
  });

  it('paginates, deduplicates IDs, excludes reposts/media-only and keeps old posts', async () => {
    const read = jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockResolvedValueOnce(
        result(
          html(
            post(10) +
              post(9, 'Чужой текст', { forwarded: true }) +
              post(8, ''),
            8,
          ),
        ),
      )
      .mockResolvedValueOnce(
        result(
          html(
            post(8, '') +
              post(7, 'Свой текст') +
              post(6, 'Старое', { date: '2025-01-01' }),
          ),
        ),
      );
    const collected = await new TelegramSourceClient().collect(
      'https://t.me/customer',
      new AbortController().signal,
      now,
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1][0]).toBe('https://t.me/s/customer?before=8');
    expect(collected.pages.map((p) => p.status)).toEqual([
      'loaded',
      'loaded',
      'found',
      'found',
      'loaded',
      'loaded',
    ]);
    expect(
      collected.pages
        .filter((p) => p.recommended)
        .map((p) => p.content)
        .join(' '),
    ).not.toMatch(/Чужой/);
    expect(
      collected.pages.find((page) => page.url.endsWith('/6'))?.content,
    ).toContain('Старое');
    expect(collected.warnings.join(' ')).toContain('Проверено публикаций: 5');
    expect(collected.pages[1].url).toBe('https://t.me/customer/10');
  });

  it('limits recent posts and reports the boundary even without a pagination link', async () => {
    jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockResolvedValue(
        result(
          html(Array.from({ length: 110 }, (_, i) => post(200 - i)).join('')),
        ),
      );
    const collected = await new TelegramSourceClient().collect(
      'https://t.me/customer',
      new AbortController().signal,
      now,
    );
    expect(collected.pages).toHaveLength(101);
    expect(collected.warnings.join(' ')).toContain('Достигнут лимит выборки');
  });

  it('keeps partial text with an explicit failure and sanitizes transport errors', async () => {
    jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockResolvedValueOnce(result(html(post(10), 10)))
      .mockRejectedValue(new Error('provider-private-error'));
    const collected = await new TelegramSourceClient().collect(
      'https://t.me/customer',
      new AbortController().signal,
      now,
    );
    expect(collected.pages.at(-1)?.status).toBe('failed');
    expect(collected.pages[1].content).toContain('Услуги');
    expect(JSON.stringify(collected)).not.toContain('provider-private-error');
  });

  it('rejects empty/login pages, protects redirects and propagates cancellation', async () => {
    const read = jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockResolvedValue(result('<h1>Log in</h1>'));
    await expect(
      new TelegramSourceClient().collect(
        'https://t.me/customer',
        new AbortController().signal,
        now,
      ),
    ).rejects.toThrow('не найдены');
    const guard = read.mock.calls[0][1]!.beforeRequest!;
    for (const address of [
      'https://127.0.0.1/',
      'https://t.me/customer',
      'https://evil.org/s/customer',
      'https://t.me/s/other',
      'https://t.me/s/customer?before=1',
    ])
      expect(() => guard(new URL(address))).toThrow('недоступна');
    expect(() => guard(new URL('https://t.me/s/customer'))).not.toThrow();
    const abort = new AbortController();
    abort.abort();
    await expect(
      new TelegramSourceClient().collect(
        'https://t.me/customer',
        abort.signal,
        now,
      ),
    ).rejects.toThrow();
  });

  it('detects repeated pagination instead of claiming a complete archive', async () => {
    jest
      .spyOn(publicMaterial, 'readPublicResource')
      .mockResolvedValue(result(html(post(10), 10)));
    const collected = await new TelegramSourceClient().collect(
      'https://t.me/customer',
      new AbortController().signal,
      now,
    );
    expect(collected.pages.at(-1)?.error).toContain('повторяет');
  });
});
