import { DeepseekService } from './deepseek.service';
import { DeepseekSettingsService } from './deepseek-settings.service';
import {
  CreationAiService,
  CreationAiInput,
} from '../content-center/creation-ai.service';
import { PreparationAiService } from '../content-center/preparation-ai.service';
import { sanitizeAuditChanges } from '../audit/audit.service';

const TEST_KEY = 'sk-test-only-not-a-real-key';
const input: CreationAiInput = {
  kind: 'production',
  context: {
    preparedInformation: {
      id: 'v1',
      content: 'Компания работает с 2010 года.',
    },
    researchResults: [],
    projectRules: 'Только факты',
    platforms: [],
    clusters: [],
    existingContent: [],
    instruction: 'Напиши статью',
  },
  cluster: {
    id: 'cluster',
    workspace_id: 'workspace-a',
    number: 1,
    title: 'Компания',
    direction: '',
    queries: [],
    archived: false,
    revision: 1,
    created_at: '',
    updated_at: '',
  },
  platform: { siteId: 'site-a', name: 'Media', rules: '' },
  article: null,
};
const article = {
  title: 'Компания',
  excerpt: '',
  document: {
    version: 1,
    blocks: [
      { id: 'p1', type: 'paragraph', text: 'Компания основана в 2010 году.' },
    ],
  },
};
const production = {
  relevant: true,
  recommendation: 'create',
  rationale: 'Есть факты',
  purpose: 'Знакомство',
  task: 'Рассказать',
  need: 'Информация',
  contentRationale: 'Информация о компании',
  article,
};

describe('DeepSeek adapter', () => {
  let fetchMock: jest.SpyInstance;
  let credentials: jest.Mock;
  let markVerified: jest.Mock;
  let settings: DeepseekSettingsService;
  let ai: DeepseekService;
  function respond(output: unknown, finish = 'stop') {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: finish,
                message: { content: JSON.stringify(output) },
              },
            ],
          }),
        ),
      ),
    );
  }
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
    credentials = jest.fn().mockResolvedValue({
      apiKey: TEST_KEY,
      model: 'deepseek-flash',
      revision: 1,
    });
    markVerified = jest.fn().mockResolvedValue({ configured: true });
    settings = {
      configured: true,
      credentials,
      markVerified,
    } as unknown as DeepseekSettingsService;
    ai = new DeepseekService(settings);
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the configured model for bounded JSON page selection, not final-document generation', async () => {
    const selection = {
      task: 'Профиль компании',
      project: [],
      pages: [
        {
          id: 4,
          url: 'https://example.com/blog/case',
          title: 'Кейс',
          excerpt: 'Описание проекта компании.',
        },
      ],
    };
    respond({
      pages: [{ id: 4, decision: 'include', reason: 'Кейс компании' }],
    });
    expect(
      await ai.selectPages(selection, new AbortController().signal),
    ).toEqual([{ id: 4, decision: 'include', reason: 'Кейс компании' }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      model: string;
      response_format: unknown;
      messages: Array<{ content: string }>;
      max_tokens: number;
    };
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(body.model).toBe('deepseek-flash');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('Основные страницы');
    expect(JSON.parse(body.messages[1].content)).toEqual(selection);
    expect(body.max_tokens).toBe(4096);
    expect(JSON.stringify(body.messages).length).toBeLessThanOrEqual(60000);
    fetchMock.mockClear();
    await expect(
      ai.selectPages(
        { ...selection, task: 'x'.repeat(60000) },
        new AbortController().signal,
      ),
    ).rejects.toThrow('60 000');
    expect(fetchMock).not.toHaveBeenCalled();
    respond({
      pages: [{ id: 99, decision: 'exclude', reason: 'Чужая страница' }],
    });
    await expect(
      ai.selectPages(selection, new AbortController().signal),
    ).rejects.toThrow('некорректный отбор');
  });

  it('keeps every staged preparation request including the final DeepSeek system message within 60k', async () => {
    respond({ content: '[S1.1] Компания, цена 2500 ₽, условия.' });
    await new PreparationAiService(ai).generate('Подготовь обзор', {
      materials: [
        {
          title: '[S1.1] Компания',
          content: 'Факты о компании.\n'.repeat(6000),
          sourceUrl: 'https://example.com/',
        },
      ],
      previousResult: 'Предыдущая версия.\n'.repeat(3500),
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    for (const call of fetchMock.mock.calls as [string, RequestInit][]) {
      const body = JSON.parse(call[1].body as string) as {
        messages: unknown[];
      };
      expect(JSON.stringify(body.messages).length).toBeLessThanOrEqual(60000);
    }
  });

  it('rejects an oversized direct preparation call without sending it to DeepSeek', async () => {
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: {
          materials: [
            { title: 'Компания', content: 'x'.repeat(60000), sourceUrl: null },
          ],
          previousResult: null,
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('60 000');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enables both processes only after settings become configured', async () => {
    settings.configured = false;
    const prep = new PreparationAiService(ai),
      creation = new CreationAiService(ai);
    expect(prep.configured).toBe(false);
    expect(creation.connected).toBe(false);
    await expect(creation.produce(input)).rejects.toThrow(
      'AI ещё не подключён',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    settings.configured = true;
    expect(prep.configured).toBe(true);
    expect(creation.connected).toBe(true);
  });
  it('checks authenticated model access without sending project content or generating text', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] })),
    );
    await ai.checkConnection();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/models',
      expect.objectContaining({
        method: 'GET',
        body: undefined,
        redirect: 'error',
      }),
    );
    expect(markVerified).toHaveBeenCalledWith(1);
  });
  it('generates preparation from the provided workspace context using JSON output', async () => {
    respond({ content: 'Компания основана в 2010 году.' });
    const result = await ai.generate({
      instruction: 'Подготовь',
      context: {
        materials: [{ title: 'Факты', content: '2010', sourceUrl: null }],
        previousResult: null,
      },
      signal: new AbortController().signal,
    });
    expect(result.content).toContain('2010');
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'deepseek-flash',
      response_format: { type: 'json_object' },
      thinking: { type: 'disabled' },
      stream: false,
    });
    expect(options.body).not.toContain(TEST_KEY);
    expect(options.body).toContain('2010');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('validates generated articles and correction proposals before returning them', async () => {
    respond(production);
    expect(
      (await ai.produce(input, new AbortController().signal)).article,
    ).toMatchObject(article);
    const existing = {
      ...input,
      kind: 'correction',
      article: { metadata: { status: 'created' }, snapshot: article },
    } as CreationAiInput;
    respond({
      relevant: true,
      recommendation: 'update',
      rationale: 'Задача',
      proposals: [
        {
          target: 'title',
          before: 'Компания',
          after: 'О компании',
          reason: 'Яснее',
        },
      ],
    });
    expect(
      (await ai.produce(existing, new AbortController().signal)).proposals?.[0]
        .after,
    ).toBe('О компании');
    respond({
      relevant: true,
      recommendation: 'update',
      rationale: 'Задача',
      proposals: [
        {
          target: 'title',
          before: 'Не совпадает',
          after: 'Новое',
          reason: 'Яснее',
        },
      ],
    });
    await expect(
      ai.produce(existing, new AbortController().signal),
    ).rejects.toThrow('не соответствующий');
  });
  it('accepts literal newlines inside preparation JSON strings without changing the text', async () => {
    const content =
      'Реестр (описание)\n\nИсточник\r\nУсловия\tтолько внутри МКАД.';
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"content":"' + content + '"}' },
            },
          ],
        }),
      ),
    );
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ content });
  });
  it('uses a dedicated compact register system instruction and measures that exact input', async () => {
    respond({ content: '[S1.1] Компания основана в 2010 году.' });
    const context = {
      materials: [{ title: '[S1.1]', content: '2010', sourceUrl: null }],
      previousResult: null,
      processingStage: 'register' as const,
    };
    const instruction = 'Подготовь реестр фактов';
    await ai.generate({
      instruction,
      context,
      signal: new AbortController().signal,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: Array<{ content: string }>;
    };
    expect(body.messages[0].content).toContain('НЕ пишешь итоговый документ');
    expect(body.messages[0].content).toContain('до 6000 символов');
    expect(body.messages[0].content).not.toContain('максимум 80000');
    expect(ai.measureInput(instruction, context)).toBe(
      JSON.stringify(body.messages).length,
    );
  });
  it('still rejects malformed preparation JSON beyond literal whitespace', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"content":"Оборванный\nответ' },
            },
          ],
        }),
      ),
    );
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('некорректный');
  });
  it('distinguishes malformed JSON from an invalid provider envelope without leaking text', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [] })),
    );
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('без ожидаемого варианта');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '{"content":"PRIVATE' },
            },
          ],
        }),
      ),
    );
    const error = await ai
      .generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      })
      .catch((reason: unknown) => reason);
    expect(String(error)).toContain('некорректный JSON');
    expect(String(error)).not.toContain('PRIVATE');
  });
  it.each([400, 401, 402, 403, 422])(
    'sanitizes non-transient HTTP %s without retrying',
    async (status) => {
      fetchMock.mockResolvedValue(new Response(TEST_KEY, { status }));
      const error = await ai
        .produce(input, new AbortController().signal)
        .catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).not.toContain(TEST_KEY);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
  it.each([429, 500, 503])(
    'retries transient HTTP %s once and returns a complete response',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response(TEST_KEY, { status }));
      respond({ content: 'Проверенный ответ' });
      await expect(
        ai.generate({
          instruction: 'Подготовь',
          context: { materials: [], previousResult: null },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ content: 'Проверенный ответ' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it('retries a broken transport or provider envelope once without exposing it', async () => {
    fetchMock.mockRejectedValueOnce(new Error(TEST_KEY));
    respond({ content: 'Первый ответ восстановлен' });
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ content: 'Первый ответ восстановлен' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(new Response('<html>PRIVATE</html>'));
    respond({ content: 'Второй ответ восстановлен' });
    await expect(
      ai.generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ content: 'Второй ответ восстановлен' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('stops after two transport failures and keeps provider details private', async () => {
    fetchMock.mockRejectedValue(new Error(TEST_KEY));
    const error = await ai
      .generate({
        instruction: 'Подготовь',
        context: { materials: [], previousResult: null },
        signal: new AbortController().signal,
      })
      .catch((reason: unknown) => reason);
    expect(String(error)).toContain('после повторной попытки');
    expect(String(error)).not.toContain(TEST_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('rejects truncated, empty and malformed output without creating a result', async () => {
    respond(production, 'length');
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow('лимита длины');
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '' } }],
        }),
      ),
    );
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow('пустой ответ');
    respond({ ...production, article: { title: 'Неверно' } });
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow();
  });
  it.each([
    ['length', 'лимита длины'],
    ['content_filter', 'своим фильтром'],
    ['insufficient_system_resource', 'нехватки ресурсов'],
    ['aborted', 'прервал генерацию'],
    ['unknown-provider-value', 'не завершил генерацию'],
  ])(
    'reports a safe, specific termination reason: %s',
    async (finish, message) => {
      respond(production, finish);
      await expect(
        ai.produce(input, new AbortController().signal),
      ).rejects.toThrow(message);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('uses a larger preparation budget while preserving the article budget', async () => {
    respond({ content: 'Facts' });
    await ai.generate({
      instruction: 'Summarize',
      context: { materials: [], previousResult: null },
      signal: new AbortController().signal,
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":16384') as unknown,
      }),
    );
    respond(production);
    await ai.produce(input, new AbortController().signal);
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"max_tokens":8192') as unknown,
      }),
    );
  });

  it('rejects unsupported attachments before sending any request', async () => {
    await expect(
      ai.produce(
        {
          ...input,
          context: {
            ...input.context,
            file: {
              name: 'x.pdf',
              mediaType: 'application/pdf',
              dataBase64: 'AAAA',
            },
          },
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow('Вложения');
    await expect(
      ai.generate({
        instruction: '',
        context: {
          materials: [],
          previousResult: null,
          files: [
            {
              fileName: 'x.pdf',
              mediaType: 'application/pdf',
              dataBase64: 'AAAA',
            },
          ],
        },
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('текстовые');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('propagates cancellation but not raw transport errors containing secrets', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new Error(TEST_KEY));
    const error = await ai
      .produce(input, controller.signal)
      .catch((reason: unknown) => reason);
    expect(String(error)).toContain('вовремя');
    expect(String(error)).not.toContain(TEST_KEY);
  });
  it('redacts credentials from the global audit trail', () => {
    const record = sanitizeAuditChanges({
      apiKey: TEST_KEY,
      model: 'deepseek-flash',
      nested: { api_key: TEST_KEY, encryptedKey: 'ciphertext' },
    });
    expect(JSON.stringify(record)).not.toContain(TEST_KEY);
    expect(JSON.stringify(record)).not.toContain('ciphertext');
    expect(record).toMatchObject({
      submittedValues: { model: 'deepseek-flash' },
    });
  });
  it('returns safe provider errors through the creation process', async () => {
    fetchMock.mockResolvedValue(new Response(TEST_KEY, { status: 402 }));
    await expect(new CreationAiService(ai).produce(input)).rejects.toThrow(
      'Недостаточно средств',
    );
  });
});
