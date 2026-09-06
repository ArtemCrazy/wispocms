import type { QueryRunner } from 'typeorm';
import { AddNotFoundTemplateBinding1789070400000 } from './1789070400000-AddNotFoundTemplateBinding';

describe('AddNotFoundTemplateBinding1789070400000', () => {
  it('adds references and safely backfills every existing 404 without touching blocks', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddNotFoundTemplateBinding1789070400000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('ADD COLUMN "system_template_key"');
    expect(sql).toContain('WHERE "slug" = \'404\'');
    expect(sql).toContain("WHEN \"status\" = 'published' THEN 'signal'");
    expect(sql).not.toContain('SET "blocks"');
    expect(sql).not.toContain('DELETE FROM');
  });
});
