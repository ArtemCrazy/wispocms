import { BadRequestException } from '@nestjs/common';
import {
  isReservedHostname,
  normalizeHostnameInput,
  normalizeRequestHost,
} from './site-domain';

describe('site domain normalization', () => {
  it('normalizes URLs, case, paths, trailing dots and IDNs to one hostname', () => {
    expect(normalizeHostnameInput(' HTTPS://ПРИМЕР.РФ/path?q=1 ')).toBe(
      'xn--e1afmkfd.xn--p1ai',
    );
    expect(normalizeHostnameInput('Example.COM./path')).toBe('example.com');
    expect(normalizeHostnameInput('')).toBeNull();
  });

  it('rejects malformed and reserved CMS hosts', () => {
    expect(() => normalizeHostnameInput('localhost')).toThrow(
      BadRequestException,
    );
    expect(() =>
      normalizeHostnameInput('wispo-cms.45.12.74.66.nip.io'),
    ).toThrow(BadRequestException);
    expect(() => normalizeHostnameInput('https://user@example.com')).toThrow(
      BadRequestException,
    );
    expect(() => normalizeHostnameInput('ftp://example.com')).toThrow(
      BadRequestException,
    );
    expect(normalizeRequestHost('evil.test/path')).toBeNull();
    expect(isReservedHostname('localhost')).toBe(true);
  });

  it('normalizes an incoming Host without trusting a path or user info', () => {
    expect(normalizeRequestHost('Example.COM:443')).toBe('example.com');
    expect(normalizeRequestHost('user@example.com')).toBeNull();
  });
});
