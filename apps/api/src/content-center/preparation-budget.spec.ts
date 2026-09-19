import {
  preparationBatches,
  preparationRequestSize,
  PREPARATION_BATCH_TARGET,
  PREPARATION_REQUEST_LIMIT,
} from './preparation-budget';

describe('preparation request budget', () => {
  it('keeps pages intact and splits long pages at paragraphs without dropping text', () => {
    const paragraph = 'Компания: услуги и цены. '.repeat(500) + '\n\n';
    const long = paragraph.repeat(7);
    const input = [
      {
        title: '[S1.1] Контакты',
        content: 'Контакты компании',
        sourceUrl: 'https://example.com/contact',
      },
      {
        title: '[S1.2] Услуги',
        content: long,
        sourceUrl: 'https://example.com/services',
      },
    ];
    const batches = preparationBatches(
      input,
      'Сохрани факты',
      preparationRequestSize,
    );
    const parts = batches.flat();
    expect(parts[0]).toEqual(input[0]);
    const split = parts.slice(1);
    expect(split.map((p) => p.content).join('')).toBe(long);
    expect(split.slice(0, -1).every((p) => p.content.endsWith('\n\n'))).toBe(
      true,
    );
    expect(
      split.every(
        (p) =>
          p.title.startsWith('[S1.2]') && p.sourceUrl === input[1].sourceUrl,
      ),
    ).toBe(true);
    expect(
      batches.every(
        (batch) =>
          batch.reduce((sum, p) => sum + p.content.length, 0) <=
          PREPARATION_BATCH_TARGET,
      ),
    ).toBe(true);
  });

  it('accounts for escaping, metadata, instructions and the system message in every batch', () => {
    const content = '\\"\n'.repeat(40000);
    const instruction = 'Задача: '.repeat(1500);
    const batches = preparationBatches(
      [
        {
          title: 'Источники',
          content,
          sourceUrl: 'https://example.com/' + 'a'.repeat(1800),
        },
      ],
      instruction,
      preparationRequestSize,
    );
    expect(
      batches
        .flat()
        .map((p) => p.content)
        .join(''),
    ).toBe(content);
    for (const materials of batches)
      expect(
        preparationRequestSize(instruction, {
          materials,
          previousResult: null,
        }),
      ).toBeLessThanOrEqual(PREPARATION_REQUEST_LIMIT);
  });

  it('bounds an unbroken block without splitting a Unicode surrogate pair', () => {
    const content = 'a' + '😀'.repeat(50000);
    const parts = preparationBatches(
      [{ title: 'Unicode', content, sourceUrl: null }],
      'Задача',
      preparationRequestSize,
    ).flat();
    expect(parts.map((p) => p.content).join('')).toBe(content);
    expect(parts.every((p) => p.content.isWellFormed())).toBe(true);
  });

  it('rejects metadata or instructions which leave no room instead of looping or trimming', () => {
    expect(() =>
      preparationBatches(
        [{ title: 'x'.repeat(60000), content: 'Факт', sourceUrl: null }],
        'Задача',
        preparationRequestSize,
      ),
    ).toThrow('Сократите задачу');
  });
});
