import {
  PreparationAiService,
  type PreparationProvider,
  type PreparationInput,
} from './preparation-ai.service';
import {
  checkedRegister,
  REGISTER_DRAFT_TITLE,
  registerReviewBatches,
} from './preparation-verification';
import {
  preparationRequestSize,
  PREPARATION_REQUEST_LIMIT,
} from './preparation-budget';

type Request = Parameters<PreparationProvider['generate']>[0];
const isReview = (r: Request) =>
  r.instruction.startsWith('Сверь черновой реестр');
const isExtraction = (r: Request) =>
  r.instruction.startsWith('Подготовь реестр фактов');
const input: PreparationInput = {
  materials: [
    {
      title: '[S1.1] Доставка',
      content:
        'Бесплатная доставка от 100 000 ₽ только внутри МКАД.\n\n' +
        'Описание компании и её продукции.\n\n'.repeat(3000),
      sourceUrl: 'https://example.com/delivery',
    },
  ],
  previousResult: null,
};

describe('source-grounded intermediate verification', () => {
  it('returns the original qualifiers to the final input when extraction omitted them', async () => {
    const badDraft = '[S1.1] Бесплатная доставка от 100 000 ₽.';
    const corrected =
      '[S1.1] Бесплатная доставка от 100 000 ₽ только внутри МКАД. Источник https://example.com/delivery';
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockImplementation((r) =>
        Promise.resolve({
          content: isExtraction(r)
            ? badDraft
            : isReview(r)
              ? r.context.materials.some(
                  (m) =>
                    m.title !== REGISTER_DRAFT_TITLE &&
                    m.content.includes('только внутри МКАД'),
                )
                ? corrected
                : 'Нет сведений о доставке в этих фрагментах.'
              : r.context.materials.map((m) => m.content).join('\n'),
        }),
      );
    const progress = jest.fn();
    const result = await new PreparationAiService({
      name: 'test',
      generate,
    }).generate('Изучи компанию', input, progress);
    expect(result).toContain(corrected);
    const requests = generate.mock.calls.map(([r]) => r);
    const extractions = requests.filter(isExtraction);
    const reviews = requests.filter(isReview);
    expect(reviews).toHaveLength(extractions.length);
    for (const extraction of extractions) {
      const review = reviews.find(
        (r) =>
          r.context.materials[0].content ===
          extraction.context.materials[0].content,
      )!;
      expect(review.context.materials.slice(0, -1)).toEqual(
        extraction.context.materials,
      );
      expect(review.context.materials.at(-1)).toMatchObject({
        title: REGISTER_DRAFT_TITLE,
        content: badDraft,
      });
      expect(review.context.previousResult).toBeNull();
    }
    expect(
      requests.every(
        (r) =>
          preparationRequestSize(r.instruction, r.context) <=
          PREPARATION_REQUEST_LIMIT,
      ),
    ).toBe(true);
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Сверка фактов'),
      }),
    );
  });

  it('reserves room for a maximum-size review draft, instructions and escaped source text', async () => {
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockResolvedValue({ content: 'Ф'.repeat(9990) });
    await new PreparationAiService({ name: 'test', generate }).generate(
      'З'.repeat(12000),
      {
        materials: [
          {
            title: '[S1.1] Источник',
            content: '\\"\n'.repeat(14000),
            sourceUrl: 'https://example.com/',
          },
        ],
        previousResult: null,
      },
    );
    for (const [request] of generate.mock.calls)
      expect(
        preparationRequestSize(request.instruction, request.context),
      ).toBeLessThanOrEqual(60000);
    expect(generate.mock.calls.some(([r]) => isReview(r))).toBe(true);
  });

  it.each(['', 'bad\0text', 'x'.repeat(80001), '\n'.repeat(5000)])(
    'rejects an empty, corrupt or excessive register',
    (value) => {
      expect(() => checkedRegister(value)).toThrow('промежуточный реестр');
    },
  );

  it('accepts a valid register above the planning reserve when the actual review fits', () => {
    const draft = 'Подробный реестр. '.repeat(1500);
    const sources = [{ title: '[S1.1]', content: 'Факты', sourceUrl: null }];
    expect(checkedRegister(draft)).toBe(draft);
    const parts = registerReviewBatches(
      sources,
      draft,
      'Сверь',
      preparationRequestSize,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].at(-1)?.content).toBe(draft);
  });

  it('splits an escaped oversized draft without losing text or omitting original qualifiers', () => {
    const sources = [
      {
        title: '[S1.1]',
        content: 'Только внутри МКАД. ' + 'x'.repeat(35000),
        sourceUrl: null,
      },
    ];
    const draft = 'Факт \\"\n'.repeat(2800);
    const parts = registerReviewBatches(
      sources,
      draft,
      'Сверь',
      preparationRequestSize,
    );
    expect(parts.length).toBeGreaterThan(1);
    expect(
      parts
        .flatMap((p) => p.slice(sources.length))
        .map((p) => p.content)
        .join('') === draft,
    ).toBe(true);
    for (const part of parts) {
      expect(part.slice(0, sources.length)).toEqual(sources);
      expect(
        preparationRequestSize('Сверь', {
          materials: part,
          previousResult: null,
        }),
      ).toBeLessThanOrEqual(60000);
    }
  });

  it('bounds the number of review fragments before making any calls', () => {
    const sources = [
      { title: '[S1.1]', content: 'x'.repeat(55000), sourceUrl: null },
    ];
    expect(() =>
      registerReviewBatches(
        sources,
        'Р'.repeat(79999),
        'Сверь',
        preparationRequestSize,
      ),
    ).toThrow('более 8 частей');
  });

  it('completes extraction, split verification and synthesis for a verbose model response', async () => {
    const draft = 'Факты с подробными условиями. '.repeat(800);
    const verified = 'Проверенные сведения. '.repeat(500); // Valid result above the former 10k ceiling.
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockImplementation((r) =>
        Promise.resolve({
          content: isExtraction(r)
            ? draft
            : isReview(r)
              ? verified
              : 'Готовый документ',
        }),
      );
    await expect(
      new PreparationAiService({ name: 'test', generate }).generate('Обзор', {
        materials: [
          { title: '[S1.1]', content: 'x'.repeat(70000), sourceUrl: null },
        ],
        previousResult: null,
      }),
    ).resolves.toBe('Готовый документ');
    const requests = generate.mock.calls.map(([r]) => r);
    const extracts = requests.filter(isExtraction);
    const reviews = requests.filter(isReview);
    expect(reviews.length).toBeGreaterThan(extracts.length);
    expect(
      requests.at(-1)?.context.materials.every((m) => m.content === verified),
    ).toBe(true);
    for (const extraction of extracts) {
      const source = extraction.context.materials[0];
      const matching = reviews.filter(
        (r) => r.context.materials[0].content === source.content,
      );
      expect(
        matching
          .flatMap((r) =>
            r.context.materials.slice(extraction.context.materials.length),
          )
          .map((m) => m.content)
          .join('') === draft,
      ).toBe(true);
    }
    for (const r of requests)
      expect(
        preparationRequestSize(r.instruction, r.context),
      ).toBeLessThanOrEqual(60000);
  });

  it('does not synthesize or silently use an unverified draft after verification fails', async () => {
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockImplementation((r) =>
        isReview(r)
          ? Promise.reject(new Error('verification unavailable'))
          : Promise.resolve({ content: 'Черновик фактов' }),
      );
    await expect(
      new PreparationAiService({ name: 'test', generate }).generate(
        'Обзор',
        input,
      ),
    ).rejects.toThrow('verification unavailable');
    const requests = generate.mock.calls.map(([r]) => r);
    expect(requests.every((r) => isExtraction(r) || isReview(r))).toBe(true);
    expect(requests.filter(isReview).length).toBeLessThanOrEqual(3);
  });

  it('rejects a malformed review before final synthesis', async () => {
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockImplementation((r) =>
        Promise.resolve({ content: isReview(r) ? '' : 'Черновик фактов' }),
      );
    await expect(
      new PreparationAiService({ name: 'test', generate }).generate(
        'Обзор',
        input,
      ),
    ).rejects.toThrow('промежуточный реестр');
    expect(
      generate.mock.calls.every(([r]) => isExtraction(r) || isReview(r)),
    ).toBe(true);
  });

  it('does not add review calls when uncompressed source text already fits', async () => {
    const generate = jest
      .fn<ReturnType<PreparationProvider['generate']>, [Request]>()
      .mockResolvedValue({ content: 'Готовый документ' });
    await new PreparationAiService({ name: 'test', generate }).generate(
      'Обзор',
      {
        materials: [
          {
            title: '[S1.1]',
            content: 'Бесплатная доставка только внутри МКАД.',
            sourceUrl: null,
          },
        ],
        previousResult: null,
      },
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].context.materials[0].content).toContain(
      'только внутри МКАД',
    );
  });
});
