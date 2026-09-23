import {
  VkSourceClient,
  VkSourceError,
  isVkUrl,
  vkCommunityAddress,
  type VkPost,
} from './vk-source';
import { decryptVkToken, encryptVkToken } from './vk-secret';

const group = {
  id: 77,
  name: 'Компания',
  description: 'Услуги',
  status: '',
  site: '',
};
const now = new Date('2026-09-20T00:00:00Z');
const post = (id: number, changes: Partial<VkPost> = {}): VkPost => ({
  id,
  owner_id: -77,
  from_id: -77,
  date: now.getTime() / 1000,
  text: `Запись ${id}`,
  ...changes,
});
const signal = () => new AbortController().signal;

describe('customer VK collection', () => {
  afterEach(() => jest.restoreAllMocks());
  it('accepts community addresses only, never arbitrary endpoints or private URLs', () => {
    expect(vkCommunityAddress('https://vk.com/club77')).toBe('club77');
    expect(vkCommunityAddress('https://m.vk.ru/company/')).toBe('company');
    for (const url of [
      'http://vk.com/company',
      'https://vk.com.evil.test/company',
      'https://127.0.0.1/company',
      'https://u:p@vk.com/company',
      'https://vk.com/id42',
      'https://vk.com/wall-77_1',
      'https://vk.com/company?access_token=secret',
      'https://vk.com/company#wall',
    ])
      expect(() => vkCommunityAddress(url)).toThrow();
    expect(isVkUrl('https://example.com')).toBe(false);
  });
  it('requires an open community administered by the user of the key', async () => {
    const client = new VkSourceClient();
    const call = jest.spyOn(client, 'call');
    call.mockResolvedValue({
      groups: [{ ...group, is_admin: 1, is_closed: 0 }],
    });
    expect(
      await client.community('key', 'https://vk.com/club77', signal()),
    ).toMatchObject(group);
    call.mockResolvedValue([{ ...group, is_admin: 0, is_closed: 0 }]);
    await expect(
      client.community('key', 'https://vk.com/club77', signal()),
    ).rejects.toThrow('права администратора');
    expect(
      await client.community(
        'service-key',
        'https://vk.com/club77',
        signal(),
        false,
      ),
    ).toMatchObject(group);
    call.mockResolvedValue([{ ...group, is_admin: 1, is_closed: 1 }]);
    await expect(
      client.community('key', 'https://vk.com/club77', signal()),
    ).rejects.toThrow('открытые');
    await expect(
      client.community('service-key', 'https://vk.com/club77', signal(), false),
    ).rejects.toThrow('открытые');
    call.mockResolvedValue({ groups: [] });
    await expect(
      client.community('service-key', 'https://vk.com/club77', signal(), false),
    ).rejects.toThrow('не найдено');
  });
  it('uses POST to the fixed VK API and never exposes echoed tokens from provider errors', async () => {
    const token = 'DO_NOT_ECHO_VK_TOKEN';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            error_code: 5,
            request_params: [{ key: 'access_token', value: token }],
          },
        }),
      ),
    );
    await expect(
      new VkSourceClient().call(
        'wall.get',
        token,
        { owner_id: '-77' },
        signal(),
      ),
    ).rejects.toThrow('недействителен');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.vk.com/method/wall.get',
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
    });
    fetchMock.mockRejectedValue(new Error(token));
    try {
      await new VkSourceClient().call('wall.get', token, {}, signal());
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
  it('fails closed on oversized or invalid provider responses', async () => {
    const client = new VkSourceClient();
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1)));
    await expect(client.call('wall.get', 'key', {}, signal())).rejects.toThrow(
      'слишком большой',
    );
    jest
      .spyOn(client, 'call')
      .mockResolvedValue({ count: 1, items: [post(1, { owner_id: -99 })] });
    await expect(client.posts('key', 77, 0, signal())).rejects.toThrow(
      'некорректную',
    );
  });
  it('includes old own posts as dated archives, but excludes reposts, media-only posts and duplicates', async () => {
    const client = new VkSourceClient();
    const old = now.getTime() / 1000 - 200 * 86400;
    const posts = jest.spyOn(client, 'posts').mockResolvedValue({
      count: 7,
      items: [
        post(1, { date: old, is_pinned: 1 }),
        post(2, { attachments: [{}] }),
        post(3, { text: 'Запись 2' }),
        post(4, { copy_history: [{}] }),
        post(5, { text: '', attachments: [{}] }),
        post(6, { from_id: 123 }),
        post(7, { date: old }),
      ],
    });
    const result = await client.collect('key', group, signal(), now);
    expect(result.pages.map((p) => p.status)).toEqual([
      'loaded',
      'loaded',
      'loaded',
      'duplicate',
      'found',
      'found',
      'found',
      'loaded',
    ]);
    expect(result.pages[2].content).toContain('Вложения не прочитаны');
    expect(result.pages[1].content).toContain('Это дата сообщения');
    expect(result.pages[1].content).toContain('АРХИВНАЯ ПУБЛИКАЦИЯ');
    expect(result.pages[7].content).toContain('АРХИВНАЯ ПУБЛИКАЦИЯ');
    expect(result.pages[7].publishedAt).toBe(
      new Date(old * 1000).toISOString(),
    );
    expect(result.pages.slice(1).every((page) => page.publishedAt)).toBe(true);
    expect(result.pages.filter((p) => p.recommended).length).toBe(4);
    expect(posts).toHaveBeenCalledTimes(1);
  });
  it('paginates to the explicit cap and discloses incomplete coverage', async () => {
    const client = new VkSourceClient();
    const posts = jest
      .spyOn(client, 'posts')
      .mockImplementation((_key, _id, offset) =>
        Promise.resolve({
          count: 700,
          items: Array.from({ length: 100 }, (_, i) => post(offset + i + 1)),
        }),
      );
    const result = await client.collect('key', group, signal(), now);
    expect(posts.mock.calls.map((c) => c[2])).toEqual([0, 100]);
    expect(result.pages).toHaveLength(201);
    expect(result.warnings.join(' ')).toContain('первые 200');
    expect(result.warnings.join(' ')).toContain('не менее 500');
  });
  it('preserves partial data on VK errors but respects cancellation', async () => {
    const client = new VkSourceClient();
    jest
      .spyOn(client, 'posts')
      .mockRejectedValue(new VkSourceError('VK ограничил частоту запросов'));
    const result = await client.collect('key', group, signal(), now);
    expect(result.pages[0].title).toBe('Компания');
    expect(result.warnings.join(' ')).toContain('ограничил');
    const abort = new AbortController();
    abort.abort();
    await expect(
      client.collect('key', group, abort.signal, now),
    ).rejects.toThrow();
  });
  it('encrypts credentials with workspace and material authenticated binding', () => {
    const previous = process.env.AI_ENCRYPTION_KEY;
    process.env.AI_ENCRYPTION_KEY = '12'.repeat(32);
    try {
      const encrypted = encryptVkToken('secret-token', 'w1', 'm1');
      expect(encrypted).not.toContain('secret-token');
      expect(decryptVkToken(encrypted, 'w1', 'm1')).toBe('secret-token');
      expect(() => decryptVkToken(encrypted, 'w2', 'm1')).toThrow();
      expect(() => decryptVkToken(encrypted, 'w1', 'm2')).toThrow();
      expect(() =>
        decryptVkToken(encrypted + '.tampered', 'w1', 'm1'),
      ).toThrow();
    } finally {
      if (previous === undefined) delete process.env.AI_ENCRYPTION_KEY;
      else process.env.AI_ENCRYPTION_KEY = previous;
    }
  });
});
