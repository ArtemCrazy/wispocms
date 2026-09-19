import { EventEmitter } from 'node:events';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { readPublicResource } from './public-material';

jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
jest.mock('node:https', () => ({ request: jest.fn() }));

describe('DNS-pinned crawler transport', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    (lookup as jest.Mock).mockResolvedValue([
      { address: '93.184.215.14', family: 4 },
    ]);
  });
  function respond(status: number, headers: Record<string, string>, body = '') {
    (request as jest.Mock).mockImplementationOnce(
      (_url, _options, callback) => {
        const req = new EventEmitter() as EventEmitter & {
          end(): void;
          destroy(error: Error): void;
        };
        req.destroy = (error) => {
          req.emit('error', error);
        };
        req.end = () =>
          queueMicrotask(() => {
            const res = Object.assign(new EventEmitter(), {
              statusCode: status,
              headers,
              destroy: jest.fn(),
            });
            callback(res);
            res.emit('data', Buffer.from(body));
            res.emit('end');
          });
        return req;
      },
    );
  }
  it('blocks private DNS and mixed public/private answers before a socket is opened', async () => {
    (lookup as jest.Mock).mockResolvedValue([
      { address: '93.184.215.14' },
      { address: '169.254.169.254' },
    ]);
    await expect(readPublicResource('https://example.com/')).rejects.toThrow(
      'не является публичным',
    );
    expect(request).not.toHaveBeenCalled();
  });
  it('pins DNS and validates redirect policy on each hop before resolving it', async () => {
    respond(302, { location: 'https://evil.com/' });
    const beforeRequest = jest.fn((url: URL) => {
      if (url.hostname !== 'example.com') throw new Error('outside site');
    });
    await expect(
      readPublicResource('https://example.com/', { beforeRequest }),
    ).rejects.toThrow('outside site');
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
    const opts = (request as jest.Mock).mock.calls[0][1];
    const pinned = jest.fn();
    opts.lookup('example.com', {}, pinned);
    expect(pinned).toHaveBeenCalledWith(null, '93.184.215.14', 4);
    expect(opts.agent).toBe(false);
  });
  it('rechecks DNS on same-site redirects', async () => {
    respond(302, { location: '/internal' });
    (lookup as jest.Mock)
      .mockResolvedValueOnce([{ address: '93.184.215.14' }])
      .mockResolvedValueOnce([{ address: '127.0.0.1' }]);
    await expect(readPublicResource('https://example.com/')).rejects.toThrow(
      'не является публичным',
    );
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes and rejects unexpected encodings', async () => {
    respond(200, { 'content-type': 'text/html' }, 'x'.repeat(1024 * 1024 + 1));
    await expect(readPublicResource('https://example.com/')).rejects.toThrow(
      'too large',
    );
    respond(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    await expect(readPublicResource('https://example.com/')).rejects.toThrow(
      'недоступен',
    );
  });
});
