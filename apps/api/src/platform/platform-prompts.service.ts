import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

export type PlatformPrompt = {
  id: string;
  title: string;
  content: string;
  revision: number;
  updatedAt: string;
};
const columns = 'id,title,content,revision,updated_at AS "updatedAt"';

@Injectable()
export class PlatformPromptsService {
  constructor(private readonly db: DataSource) {}

  list(): Promise<PlatformPrompt[]> {
    return this.db.query(
      `SELECT ${columns} FROM platform_prompts ORDER BY created_at DESC,id`,
    );
  }

  async create(input: {
    title: string;
    content: string;
  }): Promise<PlatformPrompt> {
    return this.db.transaction(async (manager) => {
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtext('platform-prompts'))",
      );
      const [count] = await manager.query<Array<{ count: number }>>(
        'SELECT count(*)::int AS count FROM platform_prompts',
      );
      if (count.count >= 100)
        throw new ConflictException('В общей библиотеке уже 100 промптов');
      const [prompt] = await manager.query<PlatformPrompt[]>(
        `INSERT INTO platform_prompts (title,content) VALUES ($1,$2) RETURNING ${columns}`,
        [input.title, input.content],
      );
      return prompt;
    });
  }

  async update(
    id: string,
    input: { title: string; content: string; revision: number },
  ): Promise<PlatformPrompt> {
    const [prompt] = await this.db.query<PlatformPrompt[]>(
      `WITH changed AS (
      UPDATE platform_prompts SET title=$2,content=$3,revision=revision+1,updated_at=now()
      WHERE id=$1 AND revision=$4 RETURNING ${columns}
    ) SELECT * FROM changed`,
      [id, input.title, input.content, input.revision],
    );
    if (!prompt) await this.rejectStale(id);
    return prompt;
  }

  async remove(id: string, revision: number): Promise<{ removed: true }> {
    const rows = await this.db.query<Array<{ id: string }>>(
      `WITH removed AS (
      DELETE FROM platform_prompts WHERE id=$1 AND revision=$2 RETURNING id
    ) SELECT * FROM removed`,
      [id, revision],
    );
    if (!rows.length) await this.rejectStale(id);
    return { removed: true };
  }

  private async rejectStale(id: string): Promise<never> {
    const rows = await this.db.query<Array<{ id: string }>>(
      'SELECT id FROM platform_prompts WHERE id=$1',
      [id],
    );
    if (!rows.length)
      throw new NotFoundException('Промпт уже удалён. Обновите список.');
    throw new ConflictException(
      'Промпт изменён другим администратором. Обновите список перед сохранением.',
    );
  }
}
