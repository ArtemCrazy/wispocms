import {
  createOriginProtection,
  normalizeOrigins,
} from './origin-protection.middleware';

describe('origin protection middleware', () => {
  const allowedOrigin = 'https://cms.example.test';

  function run(method: string, headers: Record<string, string> = {}) {
    const request = {
      method,
      header: (name: string) => headers[name.toLowerCase()],
    };
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const next = jest.fn();

    createOriginProtection([allowedOrigin])(
      request as never,
      { status } as never,
      next,
    );

    return { status, json, next };
  }

  it('allows safe requests regardless of their origin', () => {
    const result = run('GET', {
      origin: 'https://another.example.test',
      'sec-fetch-site': 'cross-site',
    });

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.status).not.toHaveBeenCalled();
  });

  it('allows an unsafe request from the configured CMS origin', () => {
    const result = run('POST', {
      origin: `${allowedOrigin}/`,
      'sec-fetch-site': 'same-origin',
    });

    expect(result.next).toHaveBeenCalledTimes(1);
    expect(result.status).not.toHaveBeenCalled();
  });

  it('blocks unsafe requests from another origin', () => {
    const result = run('PATCH', {
      origin: 'https://attacker.example.test',
      'sec-fetch-site': 'cross-site',
    });

    expect(result.next).not.toHaveBeenCalled();
    expect(result.status).toHaveBeenCalledWith(403);
    expect(result.json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 }),
    );
  });

  it('supports a comma-separated allowlist', () => {
    expect(normalizeOrigins('https://one.test/, https://two.test,  ')).toEqual([
      'https://one.test',
      'https://two.test',
    ]);
  });
});
