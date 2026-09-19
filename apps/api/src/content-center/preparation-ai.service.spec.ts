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
    expect(called[0].instruction).toBe('Подготовь документ');
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
      await jest.advanceTimersByTimeAsync(180001);
      await promise;
    } finally {
      jest.useRealTimers();
    }
  });
});
