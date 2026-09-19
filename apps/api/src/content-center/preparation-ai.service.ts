import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';

export type PreparationInput = {
  materials: Array<{
    title: string;
    content: string;
    sourceUrl: string | null;
  }>;
  previousResult: string | null;
  files?: Array<{ fileName: string; mediaType: string; dataBase64: string }>;
};

export const PREPARATION_PROVIDER = Symbol('PREPARATION_PROVIDER');

/** Implement this contract when an AI provider is selected. Keep credentials on the server. */
export interface PreparationProvider {
  readonly configured?: boolean;
  readonly name: string;
  readonly supportsFiles?: boolean;
  generate(request: {
    instruction: string;
    context: PreparationInput;
    signal: AbortSignal;
  }): Promise<{ content: string }>;
}

@Injectable()
export class PreparationAiService {
  constructor(
    @Optional()
    @Inject(PREPARATION_PROVIDER)
    private readonly provider?: PreparationProvider,
  ) {}

  get name() {
    return this.provider?.name ?? 'not-connected';
  }
  get configured() {
    return Boolean(this.provider && this.provider.configured !== false);
  }
  get supportsFiles() {
    return this.provider?.supportsFiles === true;
  }

  async generate(
    instruction: string,
    input: PreparationInput,
  ): Promise<string> {
    if (!this.provider || !this.configured)
      throw new ServiceUnavailableException(
        'AI ещё не подключён. Материалы и промпты можно подготовить заранее.',
      );
    if (input.files?.length && !this.supportsFiles)
      throw new ServiceUnavailableException(
        'AI не поддерживает вложенные файлы',
      );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.provider.generate({
          instruction,
          context: input,
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('AI timeout'));
          }, 180000);
        }),
      ]);
      const content = result.content?.trim();
      if (!content || content.length > 80000 || content.includes('\0')) {
        throw new ServiceUnavailableException(
          'AI вернул неполный результат. Текущая версия сохранена; уточните задачу и повторите запуск.',
        );
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}
