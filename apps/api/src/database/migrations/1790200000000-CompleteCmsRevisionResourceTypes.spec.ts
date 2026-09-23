import type { QueryRunner } from 'typeorm';
import { CompleteCmsRevisionResourceTypes1790200000000 } from './1790200000000-CompleteCmsRevisionResourceTypes';

describe('CompleteCmsRevisionResourceTypes1790200000000', () => {
  it('allows every remaining independently published CMS resource', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CompleteCmsRevisionResourceTypes1790200000000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    for (const resource of [
      'site_variables',
      'site_seo',
      'site_search',
      'site_not_found',
      'site_privacy',
      'template',
      'chunk',
    ])
      expect(sql).toContain(`'${resource}'`);
  });
});
