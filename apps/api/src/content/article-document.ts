import { BadRequestException } from '@nestjs/common';
import { ArticleDocument, ArticleDocumentBlock } from '../database/entities';

const MAX_BLOCKS = 500;
const MAX_TEXT = 50_000;
const MAX_LIST_ITEMS = 200;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, field: string, max = MAX_TEXT) {
  if (typeof value !== 'string')
    throw new BadRequestException(`Поле ${field} должно быть строкой`);
  if (value.length > max)
    throw new BadRequestException(`Поле ${field} слишком длинное`);
  return [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('');
}

function optionalText(value: unknown, field: string, max = MAX_TEXT) {
  return value === undefined || value === null || value === ''
    ? undefined
    : text(value, field, max);
}

export function safeArticleHref(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const href = text(value, 'href', 2000).trim();
  if (/^(?:https?:\/\/|mailto:|\/|#)/i.test(href)) return href;
  throw new BadRequestException('Ссылка использует недопустимую схему');
}

export function legacyArticleDocument(body: string): ArticleDocument {
  return {
    version: 1,
    blocks: body.trim()
      ? [{ id: 'legacy-body', type: 'paragraph', text: body }]
      : [],
  };
}

export function normalizeArticleDocument(
  input: unknown,
  legacyBody = '',
): ArticleDocument {
  if (input === undefined || input === null)
    return legacyArticleDocument(legacyBody);
  const document = record(input);
  if (!document || document.version !== 1 || !Array.isArray(document.blocks))
    throw new BadRequestException('Неверный формат документа статьи');
  if (document.blocks.length > MAX_BLOCKS)
    throw new BadRequestException('В статье слишком много блоков');
  const ids = new Set<string>();
  const blocks = document.blocks.map((raw, index): ArticleDocumentBlock => {
    const block = record(raw);
    if (!block) throw new BadRequestException(`Блок ${index + 1} повреждён`);
    const id = text(block.id, `blocks[${index}].id`, 80).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
      throw new BadRequestException(
        'Идентификаторы блоков должны быть уникальны',
      );
    ids.add(id);
    switch (block.type) {
      case 'heading': {
        const level = Number(block.level);
        if (level !== 2 && level !== 3 && level !== 4)
          throw new BadRequestException('Допустимы заголовки уровней 2–4');
        return { id, type: 'heading', level, text: text(block.text, 'text') };
      }
      case 'paragraph':
        return {
          id,
          type: 'paragraph',
          text: text(block.text, 'text'),
          href: safeArticleHref(block.href),
        };
      case 'image': {
        const mediaId = text(block.mediaId, 'mediaId', 80).trim();
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            mediaId,
          )
        )
          throw new BadRequestException('Изображение блока имеет неверный id');
        return {
          id,
          type: 'image',
          mediaId,
          alt: optionalText(block.alt, 'alt', 300),
          caption: optionalText(block.caption, 'caption', 500),
        };
      }
      case 'bullet_list':
      case 'numbered_list': {
        if (!Array.isArray(block.items) || block.items.length > MAX_LIST_ITEMS)
          throw new BadRequestException('Неверный список в документе');
        return {
          id,
          type: block.type,
          items: block.items.map((item, itemIndex) =>
            text(item, `items[${itemIndex}]`, 5000),
          ),
        };
      }
      case 'quote':
        return {
          id,
          type: 'quote',
          text: text(block.text, 'text'),
          cite: optionalText(block.cite, 'cite', 300),
        };
      default:
        throw new BadRequestException(`Неизвестный тип блока ${index + 1}`);
    }
  });
  return { version: 1, blocks };
}

export function articleDocumentText(document: ArticleDocument) {
  return document.blocks
    .flatMap((block) => {
      switch (block.type) {
        case 'image':
          return [block.alt, block.caption];
        case 'bullet_list':
        case 'numbered_list':
          return block.items;
        case 'quote':
          return [block.text, block.cite];
        default:
          return [block.text];
      }
    })
    .filter((value): value is string => Boolean(value))
    .join('\n\n');
}

export function articleDocumentMediaIds(document: ArticleDocument) {
  return document.blocks
    .filter(
      (block): block is Extract<ArticleDocumentBlock, { type: 'image' }> =>
        block.type === 'image',
    )
    .map((block) => block.mediaId);
}
