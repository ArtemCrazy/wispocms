import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import crypto from 'node:crypto';
import { ReleaseTokenGuard } from './release-token.guard';

function contextWithHeader(value?: string | string[]): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: value === undefined ? {} : { 'x-wispo-release-token': value },
      }),
    }),
  } as ExecutionContext;
}

describe('ReleaseTokenGuard', () => {
  const originalToken = process.env.WISPO_RELEASE_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.WISPO_RELEASE_TOKEN;
    else process.env.WISPO_RELEASE_TOKEN = originalToken;
    jest.restoreAllMocks();
  });

  it('accepts the exact release token from the dedicated header', () => {
    process.env.WISPO_RELEASE_TOKEN = 'server-only-release-token';

    expect(
      new ReleaseTokenGuard().canActivate(
        contextWithHeader('server-only-release-token'),
      ),
    ).toBe(true);
  });

  it.each([
    ['missing environment token', undefined, 'presented-token'],
    ['empty environment token', '', 'presented-token'],
    ['whitespace environment token', '   ', '   '],
    ['missing header', 'server-only-release-token', undefined],
    [
      'array header',
      'server-only-release-token',
      ['server-only-release-token'],
    ],
    [
      'whitespace-padded header',
      'server-only-release-token',
      ' server-only-release-token ',
    ],
    ['incorrect header', 'server-only-release-token', 'wrong'],
  ])('fails closed for %s', (_label, configured, presented) => {
    if (configured === undefined) delete process.env.WISPO_RELEASE_TOKEN;
    else process.env.WISPO_RELEASE_TOKEN = configured;

    expect(() =>
      new ReleaseTokenGuard().canActivate(contextWithHeader(presented)),
    ).toThrow(UnauthorizedException);
  });

  it('uses a timing-safe comparison even when token lengths differ', () => {
    process.env.WISPO_RELEASE_TOKEN = 'a-much-longer-server-release-token';
    const timingSafeEqual = jest.spyOn(crypto, 'timingSafeEqual');

    expect(() =>
      new ReleaseTokenGuard().canActivate(contextWithHeader('short')),
    ).toThrow(UnauthorizedException);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
    const [actual, expected] = timingSafeEqual.mock.calls[0] as [
      Buffer,
      Buffer,
    ];
    expect(actual).toHaveLength(expected.length);
  });

  it('never exposes either token in the authorization error', () => {
    const configured = 'server-secret-release-token';
    const presented = 'presented-secret-release-token';
    process.env.WISPO_RELEASE_TOKEN = configured;

    let error: unknown;
    try {
      new ReleaseTokenGuard().canActivate(contextWithHeader(presented));
    } catch (caught) {
      error = caught;
    }

    const serialized = JSON.stringify(
      error instanceof UnauthorizedException ? error.getResponse() : error,
    );
    expect(serialized).not.toContain(configured);
    expect(serialized).not.toContain(presented);
    expect(serialized).not.toContain('WISPO_RELEASE_TOKEN');
  });
});
