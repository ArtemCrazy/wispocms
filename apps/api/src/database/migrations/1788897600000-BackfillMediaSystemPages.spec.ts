import type { QueryRunner } from 'typeorm';
import { BackfillMediaSystemPages1788897600000 } from './1788897600000-BackfillMediaSystemPages';

describe('BackfillMediaSystemPages1788897600000', () => {
  it('inserts only missing canonical pages for existing media sites', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new BackfillMediaSystemPages1788897600000();

    await migration.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(1);
    const [[sql]] = query.mock.calls as Array<[string]>;
    expect(sql).toContain(`WHERE site."site_type" = 'media'`);
    expect(sql).toContain('AND NOT EXISTS');
    expect(sql).toContain('ON CONFLICT ("site_id", "slug") DO NOTHING');
    expect(sql).toContain("'privacy-policy'");
    expect(sql).toContain("'404'");
    expect(sql).toContain("'thank-you'");
    expect(sql).toContain("'capture-form'");
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE)\b/i);
  });
});
