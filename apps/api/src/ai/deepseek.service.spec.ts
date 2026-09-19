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
    fetchMock.mockResolvedValue(
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
  it.each([401, 402, 403, 429, 500])(
    'sanitizes HTTP %s and never retries a paid operation',
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
  it('rejects truncated, empty and malformed output without creating a result', async () => {
    respond(production, 'length');
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow('неполный');
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: '' } }],
        }),
      ),
    );
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow('неполный');
    respond({ ...production, article: { title: 'Неверно' } });
    await expect(
      ai.produce(input, new AbortController().signal),
    ).rejects.toThrow();
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
