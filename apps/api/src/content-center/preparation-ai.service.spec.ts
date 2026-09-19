import {
  PreparationAiService,
  type PreparationProvider,
} from './preparation-ai.service';
import {
  preparationRequestSize,
  PREPARATION_REQUEST_LIMIT,
} from './preparation-budget';

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
    const generate = jest.fn().mockResolvedValue({
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
    const extractions = generate.mock.calls.filter(([request]) =>
      request.instruction.startsWith('Подготовь реестр фактов'),
    );
    const reviews = generate.mock.calls.filter(([request]) =>
      request.instruction.startsWith('Сверь черновой реестр'),
    );
    expect(reviews).toHaveLength(extractions.length);
    expect(generate).toHaveBeenCalledTimes(extractions.length * 2 + 1);
    const contexts = generate.mock.calls.map(([request]) => request.context);
    expect(
      extractions
        .map(([request]) => request.context)
        .flatMap((c) => c.materials)
        .map((m) => m.content)
        .join(''),
    ).toBe(input.materials[0].content);
    expect(contexts.every((c) => !('sources' in c))).toBe(true);
    expect(
      contexts.slice(0, -1).every((c) => JSON.stringify(c).length < 61000),
    ).toBe(true);
    expect(contexts.at(-1).materials).toHaveLength(extractions.length);
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
  it('stages input between 60k and 120k and bounds the complete final request too', async () => {
    const generate = jest
      .fn<
        ReturnType<PreparationProvider['generate']>,
        Parameters<PreparationProvider['generate']>
      >()
      .mockResolvedValue({ content: '[S1.1] Цена 2500 ₽, условия сохранены.' });
    await new PreparationAiService({ name: 'test', generate }).generate(
      'Обзор',
      {
        materials: [
          {
            title: '[S1.1] Цены',
            content: 'Цена: 2500 ₽.\n'.repeat(6000),
            sourceUrl: 'https://example.com/price',
          },
        ],
        previousResult: null,
      },
    );
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    for (const [call] of generate.mock.calls)
      expect(
        preparationRequestSize(call.instruction, call.context),
      ).toBeLessThanOrEqual(PREPARATION_REQUEST_LIMIT);
  });
  it('compresses an oversized previous version separately and preserves current evidence unchanged', async () => {
    const generate = jest
      .fn<
        ReturnType<PreparationProvider['generate']>,
        Parameters<PreparationProvider['generate']>
      >()
      .mockResolvedValue({
        content: 'Исторические сведения, не свежий источник.',
      });
    const previousResult = 'Исторические факты.\n\n'.repeat(3500);
    const input = {
      materials: [
        {
          title: '[S1.1] Сейчас',
          content: 'Новая цена 3000 ₽',
          sourceUrl: 'https://example.com/price',
        },
      ],
      previousResult,
    };
    await new PreparationAiService({ name: 'test', generate }).generate(
      'Обнови информацию',
      input,
    );
    const requests = generate.mock.calls.map(([call]) => call);
    expect(
      requests
        .filter((r) => r.instruction.startsWith('Подготовь реестр фактов'))
        .flatMap((r) => r.context.materials)
        .map((m) => m.content)
        .join(''),
    ).toBe(previousResult);
    expect(
      requests
        .slice(0, -1)
        .every((r) => r.instruction.includes('историчес')),
    ).toBe(true);
    expect(requests.at(-1)?.context.materials).toEqual(input.materials);
    expect(requests.at(-1)?.context.previousResult).not.toBe(previousResult);
    expect(input.previousResult).toBe(previousResult);
    expect(
      requests.every(
        (r) =>
          preparationRequestSize(r.instruction, r.context) <=
          PREPARATION_REQUEST_LIMIT,
      ),
    ).toBe(true);
  });
  it('includes a long instruction when deciding whether an otherwise small material fits', async () => {
    const generate = jest
      .fn<
        ReturnType<PreparationProvider['generate']>,
        Parameters<PreparationProvider['generate']>
      >()
      .mockResolvedValue({ content: '[S1.1] Факты.' });
    await new PreparationAiService({ name: 'test', generate }).generate(
      'a'.repeat(12000),
      {
        materials: [
          { title: '[S1.1]', content: 'b'.repeat(47000), sourceUrl: null },
        ],
        previousResult: null,
      },
    );
    expect(generate.mock.calls.length).toBeGreaterThan(1);
    expect(
      generate.mock.calls.every(
        ([r]) =>
          preparationRequestSize(r.instruction, r.context) <=
          PREPARATION_REQUEST_LIMIT,
      ),
    ).toBe(true);
  });
  it('bounds re-aggregation when intermediate registers still do not fit', async () => {
    const generate = jest
      .fn<
        ReturnType<PreparationProvider['generate']>,
        Parameters<PreparationProvider['generate']>
      >()
      .mockResolvedValue({ content: 'Факты '.repeat(1200) });
    await new PreparationAiService({ name: 'test', generate }).generate(
      'Обзор',
      {
        materials: Array.from({ length: 20 }, (_, i) => ({
          title: `[S${i}.1]`,
          content: 'x'.repeat(40000),
          sourceUrl: null,
        })),
        previousResult: null,
      },
    );
    expect(generate.mock.calls.length).toBeGreaterThan(21);
    expect(
      generate.mock.calls.every(
        ([r]) =>
          preparationRequestSize(r.instruction, r.context) <=
          PREPARATION_REQUEST_LIMIT,
      ),
    ).toBe(true);
  });
  it('rejects an oversized instruction before any provider call', async () => {
    const generate = jest.fn();
    await expect(
      new PreparationAiService({ name: 'test', generate }).generate(
        'x'.repeat(61000),
        context,
      ),
    ).rejects.toThrow('Сократите');
    expect(generate).not.toHaveBeenCalled();
  });
});
