import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4');

export function publicMaterialUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException('Укажите полный HTTPS-адрес страницы');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443') ||
    isIP(url.hostname) ||
    url.hostname.includes(':') ||
    !url.hostname.includes('.') ||
    /\.(localhost|local|internal|test|invalid)$/.test(url.hostname)
  ) {
    throw new BadRequestException('Разрешены только публичные HTTPS-страницы');
  }
  url.hash = '';
  return url;
}

export function publicIpv4(address: string): boolean {
  return isIP(address) === 4 && !blocked.check(address, 'ipv4');
}

export function materialText(source: string, html: boolean): string {
  const text = (
    html
      ? source
          .replace(
            /<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
            '',
          )
          .replace(/<[^>]+>/g, ' ')
          .replace(
            /&(nbsp|amp|lt|gt|quot|apos);/g,
            (_, name: string) =>
              ({ nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[
                name
              ] ?? '',
          )
      : source
  )
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
  if (!text || text.includes('\0') || text.includes('\uFFFD'))
    throw new BadRequestException(
      'Не удалось прочитать текст. Используйте текст в UTF-8.',
    );
  return text;
}

// DNS is validated and pinned for every hop; redirects cannot reach internal services.
export type PublicResource = {
  body: string;
  html: boolean;
  url: string;
  status: number;
};

export async function readPublicResource(
  value: string,
  options: {
    beforeRequest?: (url: URL) => void | Promise<void>;
    allowNotFound?: boolean;
    xml?: boolean;
    json?: boolean;
    signal?: AbortSignal;
    userAgent?: string;
  } = {},
  hops = 0,
): Promise<PublicResource> {
  const url = publicMaterialUrl(value);
  await options.beforeRequest?.(url);
  options.signal?.throwIfAborted();
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(url.hostname, { family: 4, all: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(() => reject(new Error('DNS timeout')), 12000);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (
    !addresses.length ||
    addresses.some(({ address }) => !publicIpv4(address))
  ) {
    throw new BadRequestException('Адрес источника не является публичным');
  }
  const result = await new Promise<{
    body: string;
    html: boolean;
    status: number;
    redirect?: string;
  }>((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
          : AbortSignal.timeout(12000),
        family: 4,
        lookup: (_hostname, _options, callback) =>
          callback(null, addresses[0].address, 4),
        headers: {
          Accept: options.xml
            ? 'application/xml, text/xml, text/plain, text/html'
            : options.json
              ? 'application/json, text/plain, text/html'
              : 'text/html, text/plain, text/markdown',
          'Accept-Encoding': 'identity',
          'User-Agent': options.userAgent ?? 'WispoCMS/1.0 MaterialImport',
        },
      },
      (response) => {
        response.on('error', reject);
        const status = response.statusCode ?? 0;
        if (
          [301, 302, 303, 307, 308].includes(status) &&
          response.headers.location
        ) {
          response.destroy();
          try {
            resolve({
              body: '',
              html: false,
              status,
              redirect: new URL(response.headers.location, url).href,
            });
          } catch {
            reject(
              new BadRequestException(
                'Источник вернул некорректное перенаправление',
              ),
            );
          }
          return;
        }
        const type = response.headers['content-type'] ?? '';
        if (options.allowNotFound && [404, 410].includes(status)) {
          response.destroy();
          resolve({ body: '', html: false, status });
          return;
        }
        if (
          status !== 200 ||
          !(
            /^text\/(html|plain|markdown)\b/i.test(type) ||
            (options.json && /^application\/json\b/i.test(type)) ||
            (options.xml &&
              /^(application|text)\/(xml|[^;]+\+xml)\b/i.test(type))
          ) ||
          (response.headers['content-encoding'] &&
            response.headers['content-encoding'] !== 'identity')
        ) {
          response.destroy();
          reject(
            new BadRequestException(
              'Источник недоступен или не является текстовой страницей. Скопируйте нужный текст в материал.',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(new Error('source too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            html: /^text\/html/i.test(type),
            status,
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
  if (result.redirect) {
    if (hops >= 3)
      throw new BadRequestException('Слишком много перенаправлений источника');
    return readPublicResource(result.redirect, options, hops + 1);
  }
  return { ...result, url: url.href };
}

export async function readPublicMaterial(
  value: string,
  hops = 0,
): Promise<string> {
  const result = await readPublicResource(value, {}, hops);
  return materialText(result.body, result.html);
}
