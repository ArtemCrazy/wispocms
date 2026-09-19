import {
  PreparationAiService,
  type PreparationProvider,
} from './preparation-ai.service';

describe('provider-neutral preparation', () => {
  const context = {
    materials: [
      {
        title: 'Факты',
        content: 'Компания основана в 2010 году.',
        sourceUrl: null,
      },
    ],
    previousResult: null,
  };
  it('does not fabricate a result when no provider is connected', async () => {
    const ai = new PreparationAiService();
    expect(ai.configured).toBe(false);
    await expect(ai.generate('Подготовь документ', context)).rejects.toThrow(
      'AI ещё не подключён',
    );
  });
  it('passes the explicit instruction and current context to the adapter', async () => {
    const generate = jest
      .fn()
      .mockResolvedValue({ content: '# Компания\nОснована в 2010 году.' });
    const ai = new PreparationAiService({ name: 'test-only', generate });
    expect(ai.configured).toBe(true);
    await expect(ai.generate('Подготовь документ', context)).resolves.toContain(
      '2010',
    );
    expect(generate).toHaveBeenCalledTimes(1);
    const called = generate.mock.calls[0] as [
      Parameters<PreparationProvider['generate']>[0],
    ];
    expect(called[0].instruction).toMatch(/^Подготовь документ/);
    expect(called[0].context).toEqual(context);
    expect(called[0].signal).toBeInstanceOf(AbortSignal);
  });
  it.each(['', ' '.repeat(5), 'x'.repeat(80001), 'bad\0text'])(
    'rejects an invalid result',
    async (content) => {
      const provider: PreparationProvider = {
        name: 'test-only',
        generate: () => Promise.resolve({ content }),
      };
      await expect(
        new PreparationAiService(provider).generate('Задача', context),
      ).rejects.toThrow();
    },
  );
  it('enforces a deadline even if an adapter ignores cancellation', async () => {
    jest.useFakeTimers();
    try {
      const ai = new PreparationAiService({
        name: 'test-only',
        generate: () => new Promise(() => {}),
      });
      const promise = expect(ai.generate('Задача', context)).rejects.toThrow(
        'Истекло время ожидания AI',
      );
      await jest.advanceTimersByTimeAsync(900001);
      await promise;
    } finally {
      jest.useRealTimers();
    }
  });
  it('stages large input in bounded batches and does not send the source archive twice', async () => {
    const generate = jest
      .fn()
      .mockResolvedValue({
        content: '[S1.1] Компания продаёт оборудование. https://example.com/',
      });
    const progress = jest.fn();
    const input = {
      materials: [
        {
          title: '[S1.1] Компания',
          content: 'A'.repeat(200000),
          sourceUrl: 'https://example.com/',
        },
      ],
      previousResult: null,
      sources: [],
    };
    await new PreparationAiService({ name: 'test', generate }).generate(
      'Обзор',
      input,
      progress,
    );
    expect(generate).toHaveBeenCalledTimes(6);
    const contexts = generate.mock.calls.map(([request]) => request.context);
    expect(
      contexts
        .slice(0, -1)
        .flatMap((c) => c.materials)
        .map((m) => m.content)
        .join(''),
    ).toBe(input.materials[0].content);
    expect(contexts.every((c) => !('sources' in c))).toBe(true);
    expect(
      contexts.slice(0, -1).every((c) => JSON.stringify(c).length < 61000),
    ).toBe(true);
    expect(contexts.at(-1).materials).toHaveLength(5);
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: 'synthesizing' }),
    );
  });
  it('does not synthesize a partial result if an intermediate batch fails', async () => {
    const generate = jest
      .fn()
      .mockRejectedValue(new Error('upstream unavailable'));
    const progress = jest.fn();
    await expect(
      new PreparationAiService({ name: 'test', generate }).generate(
        'Обзор',
        {
          materials: [
            { title: 'Материал', content: 'A'.repeat(200000), sourceUrl: null },
          ],
          previousResult: null,
        },
        progress,
      ),
    ).rejects.toThrow('upstream');
    expect(generate.mock.calls.length).toBeLessThanOrEqual(3);
    expect(progress).not.toHaveBeenCalledWith(
      expect.objectContaining({ stage: 'synthesizing' }),
    );
  });
});
