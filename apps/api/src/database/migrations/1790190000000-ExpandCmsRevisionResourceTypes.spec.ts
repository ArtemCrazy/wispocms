import type { QueryRunner } from 'typeorm';
import { ExpandCmsRevisionResourceTypes1790190000000 } from './1790190000000-ExpandCmsRevisionResourceTypes';

describe('ExpandCmsRevisionResourceTypes1790190000000', () => {
  it('allows independent globals, header, and footer revision resources', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ExpandCmsRevisionResourceTypes1790190000000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('DROP CONSTRAINT "CHK_cms_revision_resources_type"');
    expect(sql).toContain("'site_globals'");
    expect(sql).toContain("'site_header'");
    expect(sql).toContain("'site_footer'");
  });
});
