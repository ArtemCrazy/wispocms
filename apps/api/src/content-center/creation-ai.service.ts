import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CreatedArticle,
  CreationContext,
  CreationSnapshot,
  ClusterRow,
} from './creation-model';
import { AiProviderError } from '../ai/ai-provider.error';

export const CREATION_PROVIDER = Symbol('CREATION_PROVIDER');
export type CreationAiInput = {
  kind: 'production' | 'correction';
  context: CreationContext;
  cluster: ClusterRow;
  platform: { siteId: string; name: string; rules: string };
  article: { metadata: CreatedArticle; snapshot: CreationSnapshot } | null;
};
/** Structured output is untrusted and validated by the domain service, never directly published. */
export interface CreationProvider {
  readonly configured?: boolean;
  supportsFiles?: boolean;
  produce(
    input: CreationAiInput,
    signal: AbortSignal,
  ): Promise<{
    relevant: boolean;
    recommendation: 'create' | 'keep' | 'update' | 'unpublish';
    rationale: string;
    purpose?: string;
    task?: string;
    need?: string;
    contentRationale?: string;
    article?: CreationSnapshot;
    proposals?: Array<{
      target: string;
      before: unknown;
      after: unknown;
      reason: string;
    }>;
  }>;
}
@Injectable()
export class CreationAiService {
  constructor(
    @Optional()
    @Inject(CREATION_PROVIDER)
    private readonly provider?: CreationProvider,
  ) {}
  get connected() {
    return Boolean(this.provider && this.provider.configured !== false);
  }
  get supportsFiles() {
    return Boolean(this.provider?.supportsFiles);
  }
  async produce(input: CreationAiInput) {
    if (!this.provider || !this.connected)
      throw new ServiceUnavailableException(
        'AI ещё не подключён. Генерация не запускалась.',
      );
    if (input.context.file && !this.supportsFiles)
      throw new ServiceUnavailableException('AI-адаптер не поддерживает файлы');
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.provider.produce(input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('AI timeout'));
          }, 90000);
        }),
      ]);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      throw new ServiceUnavailableException(
        'AI не завершил операцию. Статья не изменена; можно повторить запуск.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
