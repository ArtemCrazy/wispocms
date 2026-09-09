import { BadRequestException } from '@nestjs/common';
import type { PageBlock } from '../database/entities';

export const ARMATUREX_HOME_TEMPLATE_KEY = 'armaturex-home-v1';
export const ARMATUREX_HOME_TEMPLATE_VERSION = '1';

const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_DEPTH = 7;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATALOG_ASSETS = new Set([
  'zadvizhka-blueprint-v1.png',
  'kran-ld-blueprint-v1.png',
  'klapan-zap-blueprint-v1.png',
  'kran-blueprint-v1.png',
  'otvod-blueprint-v1.png',
  'klapan-obr-blueprint-v1.png',
  'zatvor-blueprint-v1.png',
  'perekhod-blueprint-v1.png',
  'troynik-blueprint-v1.png',
  'flanets-blueprint-v1.png',
  'privod-blueprint-v1.png',
  'regulyator-blueprint-v1.png',
]);
const TERM_ASSETS = new Set([
  'terms-payment-v1.png',
  'terms-delivery-v1.png',
  'terms-documents-v1.png',
]);
const BLOCK_TYPES = new Map<string, PageBlock['type']>([
  ['armaturex-home-v1-hero', 'hero'],
  ['armaturex-home-v1-stats', 'text'],
  ['armaturex-home-v1-catalog', 'text'],
  ['armaturex-home-v1-terms', 'text'],
  ['armaturex-home-v1-faq', 'text'],
  ['armaturex-home-v1-request', 'cta'],
]);

function fail(message: string): never {
  throw new BadRequestException(`Некорректные данные Armaturex: ${message}`);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${path} должен быть объектом`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
) {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unknown) fail(`${path}.${unknown} не поддерживается`);
}

function string(value: unknown, path: string, max: number): string;
function string(
  value: unknown,
  path: string,
  max: number,
  optional: true,
): string | undefined;
function string(value: unknown, path: string, max: number, optional = false) {
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(`${path} должен быть строкой длиной до ${max} символов`);
  return value;
}

function href(value: unknown, path: string) {
  const candidate = string(value, path, 500);
  if (
    candidate.startsWith('#') ||
    (candidate.startsWith('/') && !candidate.startsWith('//'))
  )
    return;
  try {
    const url = new URL(candidate);
    if (['https:', 'http:', 'tel:', 'mailto:'].includes(url.protocol)) return;
  } catch {
    // Report the same bounded validation error for malformed and unsafe URLs.
  }
  fail(`${path} содержит недопустимую ссылку`);
}

function mediaId(value: unknown, path: string, result: Set<string>) {
  if (value === undefined) return;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value))
    fail(`${path} должен быть UUID`);
  result.add(value);
}

function array(value: unknown, path: string, max: number) {
  if (!Array.isArray(value) || value.length > max)
    fail(`${path} должен быть массивом максимум из ${max} элементов`);
  return value as unknown[];
}

function assertDepth(value: unknown, depth = 0) {
  if (depth > MAX_DEPTH) fail(`превышена допустимая глубина ${MAX_DEPTH}`);
  if (!value || typeof value !== 'object') return;
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>))
    assertDepth(child, depth + 1);
}

function validateLink(value: unknown, path: string) {
  const link = object(value, path);
  exactKeys(link, ['label', 'href'], path);
  string(link.label, `${path}.label`, 100);
  href(link.href, `${path}.href`);
}

export function validateArmaturexPageBlocks(blocks: PageBlock[]) {
  let payload: string;
  try {
    payload = JSON.stringify(blocks);
  } catch {
    fail('payload не сериализуется');
  }
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES)
    fail(`payload превышает ${MAX_PAYLOAD_BYTES} байт`);
  assertDepth(blocks);
  if (blocks.length !== BLOCK_TYPES.size)
    fail(`ожидается ${BLOCK_TYPES.size} блоков`);

  const mediaIds = new Set<string>();
  const seen = new Set<string>();
  for (const block of blocks) {
    const rawBlock = block as unknown as Record<string, unknown>;
    exactKeys(
      rawBlock,
      [
        'id',
        'type',
        'title',
        'text',
        'buttonLabel',
        'buttonUrl',
        'mediaId',
        'data',
      ],
      block.id || 'block',
    );
    const expectedType = BLOCK_TYPES.get(block.id);
    if (!expectedType || block.type !== expectedType || seen.has(block.id))
      fail(
        `неизвестный, повторный или неверно типизированный блок ${block.id}`,
      );
    seen.add(block.id);
    mediaId(block.mediaId, `${block.id}.mediaId`, mediaIds);
    if (block.buttonUrl !== undefined)
      href(block.buttonUrl, `${block.id}.buttonUrl`);
    const data = object(block.data, `${block.id}.data`);

    if (block.id.endsWith('-hero')) {
      exactKeys(data, ['eyebrow', 'secondaryCta'], `${block.id}.data`);
      string(data.eyebrow, `${block.id}.data.eyebrow`, 160);
      validateLink(data.secondaryCta, `${block.id}.data.secondaryCta`);
    } else if (block.id.endsWith('-stats')) {
      exactKeys(data, ['items'], `${block.id}.data`);
      array(data.items, `${block.id}.data.items`, 8).forEach((item, index) => {
        const stat = object(item, `${block.id}.data.items[${index}]`);
        exactKeys(stat, ['value', 'label'], `${block.id}.data.items[${index}]`);
        string(stat.value, `${block.id}.data.items[${index}].value`, 40);
        string(stat.label, `${block.id}.data.items[${index}].label`, 160);
      });
    } else if (block.id.endsWith('-catalog')) {
      exactKeys(data, ['items'], `${block.id}.data`);
      array(data.items, `${block.id}.data.items`, 24).forEach((item, index) => {
        const path = `${block.id}.data.items[${index}]`;
        const catalog = object(item, path);
        exactKeys(
          catalog,
          [
            'name',
            'count',
            'href',
            'asset',
            'imageMediaId',
            'meta',
            'subitems',
          ],
          path,
        );
        string(catalog.name, `${path}.name`, 120);
        string(catalog.count, `${path}.count`, 20);
        href(catalog.href, `${path}.href`);
        const asset = string(catalog.asset, `${path}.asset`, 120);
        if (!CATALOG_ASSETS.has(asset)) fail(`${path}.asset не разрешён`);
        mediaId(catalog.imageMediaId, `${path}.imageMediaId`, mediaIds);
        string(catalog.meta, `${path}.meta`, 240, true);
        array(catalog.subitems, `${path}.subitems`, 8).forEach(
          (subitem, subIndex) =>
            validateLink(subitem, `${path}.subitems[${subIndex}]`),
        );
      });
    } else if (block.id.endsWith('-terms')) {
      exactKeys(data, ['items'], `${block.id}.data`);
      array(data.items, `${block.id}.data.items`, 6).forEach((item, index) => {
        const path = `${block.id}.data.items[${index}]`;
        const term = object(item, path);
        exactKeys(
          term,
          ['number', 'title', 'text', 'href', 'asset', 'imageMediaId'],
          path,
        );
        string(term.number, `${path}.number`, 10);
        string(term.title, `${path}.title`, 160);
        string(term.text, `${path}.text`, 1000);
        href(term.href, `${path}.href`);
        const asset = string(term.asset, `${path}.asset`, 120);
        if (!TERM_ASSETS.has(asset)) fail(`${path}.asset не разрешён`);
        mediaId(term.imageMediaId, `${path}.imageMediaId`, mediaIds);
      });
    } else if (block.id.endsWith('-faq')) {
      exactKeys(data, ['items'], `${block.id}.data`);
      array(data.items, `${block.id}.data.items`, 20).forEach((item, index) => {
        const path = `${block.id}.data.items[${index}]`;
        const faq = object(item, path);
        exactKeys(faq, ['question', 'answer'], path);
        string(faq.question, `${path}.question`, 300);
        string(faq.answer, `${path}.answer`, 3000);
      });
    } else {
      exactKeys(data, ['formTitle'], `${block.id}.data`);
      string(data.formTitle, `${block.id}.data.formTitle`, 120);
    }
  }
  return [...mediaIds];
}

export function validateGenericPageBlocks(blocks: PageBlock[]) {
  if (blocks.some((block) => block.data !== undefined))
    fail('structured data разрешены только зарегистрированным шаблонам');
}
