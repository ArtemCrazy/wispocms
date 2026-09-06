import { BadRequestException } from '@nestjs/common';
import { domainToASCII } from 'node:url';

const DEFAULT_RESERVED_HOSTS = [
  'localhost',
  'wispo-cms.45.12.74.66.nip.io',
  'api.wispo.ru',
  'cms.wispo.ru',
];

function reservedHosts() {
  return new Set(
    [
      ...DEFAULT_RESERVED_HOSTS,
      ...(process.env.WISPO_RESERVED_HOSTS ?? '').split(','),
    ]
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
      .filter(Boolean),
  );
}

export function normalizeHostnameInput(value?: string | null) {
  const input = value?.trim();
  if (!input) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
  } catch {
    throw new BadRequestException('Укажите корректное доменное имя');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new BadRequestException('Укажите корректное доменное имя');
  const ascii = domainToASCII(parsed.hostname.toLowerCase().replace(/\.$/, ''));
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii.includes('..') ||
    !ascii.includes('.') ||
    ascii
      .split('.')
      .some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  )
    throw new BadRequestException('Укажите корректное доменное имя');
  if (reservedHosts().has(ascii))
    throw new BadRequestException(
      'Служебный домен Wispo нельзя назначить публичному сайту',
    );
  return ascii;
}

export function normalizeRequestHost(value?: string | null) {
  const input = value?.trim().toLowerCase();
  if (
    !input ||
    input.includes('/') ||
    input.includes('\\') ||
    /[?#@\s]/.test(input)
  )
    return null;
  const hostname = input.startsWith('[')
    ? null
    : input.replace(/:\d{1,5}$/, '').replace(/\.$/, '');
  if (!hostname) return null;
  const ascii = domainToASCII(hostname);
  if (
    !ascii ||
    ascii.length > 253 ||
    ascii
      .split('.')
      .some(
        (label) =>
          !label ||
          label.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
      )
  )
    return null;
  return ascii;
}

export function isReservedHostname(hostname: string) {
  return reservedHosts().has(hostname);
}

export function configuredDomainTargets() {
  return (process.env.PUBLIC_DOMAIN_TARGETS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase().replace(/\.$/, ''))
    .filter(Boolean);
}
