import { BadRequestException } from '@nestjs/common';
import {
  articleDocumentMediaIds,
  articleDocumentText,
  legacyArticleDocument,
  normalizeArticleDocument,
} from './article-document';

describe('article document', () => {
  it('keeps legacy body losslessly in a versioned paragraph', () => {
    const body = 'Первая строка\n\nВторая строка <без HTML-интерпретации>';
    const document = legacyArticleDocument(body);
    expect(document).toEqual({
      version: 1,
      blocks: [{ id: 'legacy-body', type: 'paragraph', text: body }],
    });
    expect(articleDocumentText(document)).toBe(body);
  });

  it('normalizes all supported visual block types', () => {
    const document = normalizeArticleDocument({
      version: 1,
      blocks: [
        { id: 'h', type: 'heading', level: 2, text: 'Заголовок' },
        {
          id: 'p',
          type: 'paragraph',
          text: 'Текст',
          href: 'https://example.com',
        },
        { id: 'b', type: 'bullet_list', items: ['Один', 'Два'] },
        { id: 'n', type: 'numbered_list', items: ['Первый'] },
        { id: 'q', type: 'quote', text: 'Цитата', cite: 'Автор' },
        {
          id: 'i',
          type: 'image',
          mediaId: '00000000-0000-4000-8000-000000000001',
          alt: 'Фото',
        },
      ],
    });
    expect(document.blocks).toHaveLength(6);
    expect(articleDocumentMediaIds(document)).toEqual([
      '00000000-0000-4000-8000-000000000001',
    ]);
  });

  it('rejects executable and malformed links', () => {
    expect(() =>
      normalizeArticleDocument({
        version: 1,
        blocks: [
          {
            id: 'p',
            type: 'paragraph',
            text: 'click',
            href: 'javascript:alert(1)',
          },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects duplicate ids and unknown blocks', () => {
    expect(() =>
      normalizeArticleDocument({
        version: 1,
        blocks: [
          { id: 'same', type: 'paragraph', text: 'one' },
          { id: 'same', type: 'paragraph', text: 'two' },
        ],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      normalizeArticleDocument({
        version: 1,
        blocks: [{ id: 'x', type: 'html', html: '<script />' }],
      }),
    ).toThrow(BadRequestException);
  });
});
