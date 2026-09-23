import { BadRequestException } from '@nestjs/common';
import {
  youtubeChannel,
  instagramUsername,
  isSocialUrl,
} from './social-address';
import { YoutubeSourceClient } from './youtube-source';
import { InstagramSourceClient } from './instagram-source';
import {
  decryptSocialSecret,
  encryptSocialSecret,
  socialJson,
} from './social-api';
import { validateInstagramRedirect } from './platform-social-settings.service';

const signal = () => new AbortController().signal;
const channelId = `UC${'a'.repeat(22)}`;
const profile = { user_id: '17841400000000', username: 'company' };
afterEach(() => jest.restoreAllMocks());

it('accepts channels/profiles, rejects misleading hosts, credentials, posts and unsupported video links', () => {
  expect(youtubeChannel('https://youtube.com/@company')).toEqual({
    key: 'forHandle',
    value: '@company',
  });
  expect(youtubeChannel(`https://youtube.com/channel/${channelId}`)).toEqual({
    key: 'id',
    value: channelId,
  });
  expect(instagramUsername('https://www.instagram.com/Company/')).toBe(
    'company',
  );
  for (const url of [
    'http://youtube.com/@company',
    'https://youtube.com.evil.test/@company',
    'https://youtube.com/c/company',
    'https://youtu.be/abcdefghijk',
    'https://youtube.com/watch?v=abcdefghijk',
    'https://a:b@youtube.com/@company',
  ])
    expect(() => youtubeChannel(url)).toThrow();
  for (const url of [
    'https://instagram.com/p/abc',
    'https://instagram.com/reels',
    'https://instagram.com/company?x=y',
    'https://instagram.com.evil.test/company',
    'https://a:b@instagram.com/company',
  ])
    expect(() => instagramUsername(url)).toThrow();
  expect(isSocialUrl('https://instagram.com.evil.test/a', 'instagram')).toBe(
    false,
  );
  expect(() => youtubeChannel('https://youtube.com/@abc%ZZ')).toThrow(
    BadRequestException,
  );
});

it('restricts OAuth return URI to configured HTTPS CMS origin and exact path', () => {
  const previous = process.env.WEB_ORIGIN;
  process.env.WEB_ORIGIN = 'https://cms.example.test';
  try {
    expect(
      validateInstagramRedirect(
        'https://cms.example.test/api/social/instagram/callback',
      ),
    ).toBe('https://cms.example.test/api/social/instagram/callback');
    for (const value of [
      'https://evil.test/api/social/instagram/callback',
      'https://cms.example.test/elsewhere',
      'http://cms.example.test/api/social/instagram/callback',
      'https://cms.example.test/api/social/instagram/callback?redirect=evil',
    ])
      expect(() => validateInstagramRedirect(value)).toThrow();
  } finally {
    if (previous === undefined) delete process.env.WEB_ORIGIN;
    else process.env.WEB_ORIGIN = previous;
  }
});

it('encrypts credentials with workspace/material binding and never accepts ciphertext for another source', () => {
  const previous = process.env.AI_ENCRYPTION_KEY;
  process.env.AI_ENCRYPTION_KEY = '35'.repeat(32);
  try {
    const ciphertext = encryptSocialSecret(
      'test-key-not-real',
      'instagram:w:m',
    );
    expect(ciphertext).not.toContain('test-key-not-real');
    expect(decryptSocialSecret(ciphertext, 'instagram:w:m')).toBe(
      'test-key-not-real',
    );
    expect(() =>
      decryptSocialSecret(ciphertext, 'instagram:other:m'),
    ).toThrow();
  } finally {
    if (previous === undefined) delete process.env.AI_ENCRYPTION_KEY;
    else process.env.AI_ENCRYPTION_KEY = previous;
  }
});

it('bounds API responses, disables redirects and redacts provider error bodies', async () => {
  const fetcher = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('SECRET provider error', { status: 403 }));
  await expect(
    socialJson('https://www.googleapis.com/youtube/v3/channels', {}, signal()),
  ).rejects.not.toThrow('SECRET');
  expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
  fetcher.mockResolvedValue(new Response('x'.repeat(4 * 1024 * 1024 + 1)));
  await expect(
    socialJson('https://www.googleapis.com/youtube/v3/channels', {}, signal()),
  ).rejects.toThrow('Сервис');
});

it('collects YouTube uploads by channel, preserves old publication dates and does not pretend video was watched', async () => {
  const client = new YoutubeSourceClient();
  const call = jest
    .spyOn(client, 'call')
    .mockResolvedValueOnce({
      items: [
        {
          id: channelId,
          snippet: { title: 'Company', description: 'Services' },
          contentDetails: { relatedPlaylists: { uploads: 'UUtest' } },
        },
      ],
    })
    .mockResolvedValueOnce({
      items: [
        { contentDetails: { videoId: 'abcdefghijk' } },
        { contentDetails: { videoId: 'missing0000' } },
      ],
    })
    .mockResolvedValueOnce({
      items: [
        {
          id: 'abcdefghijk',
          snippet: {
            channelId,
            title: 'Old offer',
            description: 'Source text',
            publishedAt: '2020-01-01T00:00:00Z',
          },
          status: { privacyStatus: 'public' },
        },
      ],
    });
  const result = await client.collect(
    'test',
    'https://youtube.com/@company',
    signal(),
  );
  expect(call.mock.calls[0][2]).toMatchObject({ forHandle: '@company' });
  expect(result.pages).toHaveLength(3);
  expect(result.pages[1].content).toContain('2020-01-01');
  expect(result.pages[1].content).toContain('не просмотрено');
  expect(result.pages[2].status).toBe('failed');
  expect(call.mock.calls.map((args) => args[0])).toEqual([
    'channels',
    'playlistItems',
    'videos',
  ]);
});

it('stops YouTube at 100 entries and marks remaining coverage', async () => {
  const client = new YoutubeSourceClient();
  let offset = 0;
  jest.spyOn(client, 'call').mockImplementation((method, _key, params) => {
    if (method === 'channels')
      return Promise.resolve({
        items: [
          {
            id: channelId,
            snippet: { title: 'Company' },
            contentDetails: { relatedPlaylists: { uploads: 'UUtest' } },
          },
        ],
      });
    if (method === 'playlistItems') {
      const ids = Array.from({ length: 50 }, (_, i) =>
        String(i + offset).padStart(11, '0'),
      );
      offset += 50;
      return Promise.resolve({
        items: ids.map((videoId) => ({ contentDetails: { videoId } })),
        nextPageToken: String(offset),
      });
    }
    return Promise.resolve({
      items: params.id.split(',').map((id) => ({
        id,
        snippet: {
          channelId,
          title: id,
          publishedAt: '2020-01-01T00:00:00Z',
        },
        status: { privacyStatus: 'public' },
      })),
    });
  });
  const result = await client.collect(
    'test',
    'https://youtube.com/@company',
    signal(),
  );
  expect(result.pages).toHaveLength(101);
  expect(offset).toBe(100);
  expect(result.warnings.join(' ')).toContain('предел');
});

it('reads Instagram captions, excludes media-only posts, and uses cursors instead of paging.next URLs', async () => {
  const client = new InstagramSourceClient();
  const call = jest
    .spyOn(client, 'call')
    .mockResolvedValueOnce(profile)
    .mockResolvedValueOnce({
      data: [
        {
          id: '11111',
          caption: 'Business facts',
          timestamp: '2020-01-01',
          media_type: 'IMAGE',
          permalink: 'https://www.instagram.com/p/abc/',
        },
      ],
      paging: {
        next: 'https://evil.test/?access_token=secret',
        cursors: { after: 'safe-cursor' },
      },
    })
    .mockResolvedValueOnce({
      data: [
        {
          id: '22222',
          timestamp: '2020-01-02',
          media_type: 'VIDEO',
          permalink: 'https://www.instagram.com/reel/def/',
        },
      ],
    });
  const result = await client.collect(
    'test',
    profile.user_id,
    'company',
    signal(),
  );
  expect(result.pages[1].content).toContain('Business facts');
  expect(result.pages[2]).toMatchObject({
    recommended: false,
    reason: 'Нет текстовой подписи. Изображение или видео не прочитано.',
  });
  expect(call.mock.calls[2][0]).toBe(`${profile.user_id}/media`);
  expect(call.mock.calls[2][2]).toMatchObject({ after: 'safe-cursor' });
  expect(JSON.stringify(result)).not.toContain('evil.test');
});

it('rejects Instagram account substitution before reading media', async () => {
  const client = new InstagramSourceClient();
  const call = jest
    .spyOn(client, 'call')
    .mockResolvedValue({ ...profile, username: 'other' });
  await expect(
    client.collect('test', profile.user_id, 'company', signal()),
  ).rejects.toThrow('Профиль Instagram изменился');
  expect(call).toHaveBeenCalledTimes(1);
});

it('exchanges the Instagram code only against fixed hosts and validates token expiry', async () => {
  const client = new InstagramSourceClient();
  const fetcher = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      Response.json({ access_token: 'short-test-token-not-real' }),
    )
    .mockResolvedValueOnce(
      Response.json({
        access_token: 'long-test-token-not-real',
        expires_in: 60 * 86400,
      }),
    );
  const result = await client.exchange(
    'code',
    '1234567',
    'secret',
    'https://cms.example.test/api/social/instagram/callback',
    signal(),
  );
  expect(result.token).toBe('long-test-token-not-real');
  expect(new URL(fetcher.mock.calls[0][0] as string | URL).hostname).toBe(
    'api.instagram.com',
  );
  expect(new URL(fetcher.mock.calls[1][0] as string | URL).hostname).toBe(
    'graph.instagram.com',
  );
  expect(fetcher.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
});
