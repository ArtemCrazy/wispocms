import {
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ResearchCategoryDto } from './research.dto';

export const RESEARCH_SEARCH_PROVIDER = Symbol('RESEARCH_SEARCH_PROVIDER');
export type ResearchSearchInput = {
  direction: string;
  context: {
    versionId: string;
    kind: 'full' | 'conclusions';
    content: string;
  } | null;
  categories: ResearchCategoryDto[];
};
export interface ResearchSearchProvider {
  search(
    input: ResearchSearchInput,
    signal: AbortSignal,
  ): Promise<
    Array<{
      name: string;
      url: string;
      categoryId: string;
      description: string;
    }>
  >;
}

/** The adapter must perform real search; model-invented URLs are not search results. */
@Injectable()
export class ResearchSearchService {
  constructor(
    @Optional()
    @Inject(RESEARCH_SEARCH_PROVIDER)
    private readonly provider?: ResearchSearchProvider,
  ) {}
  get connected() {
    return Boolean(this.provider);
  }
  async search(input: ResearchSearchInput) {
    if (!this.provider)
      throw new ServiceUnavailableException(
        'Автоматический поиск ещё не подключён. Источники можно добавить вручную.',
      );
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.provider.search(input, controller.signal),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error('Search timeout'));
          }, 45000);
        }),
      ]);
    } catch {
      throw new ServiceUnavailableException(
        'Поиск не завершён. Сохранённые источники не изменены; попробуйте ещё раз.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
