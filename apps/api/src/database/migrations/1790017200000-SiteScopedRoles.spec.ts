import type { QueryRunner } from 'typeorm';
import { SiteScopedRoles1790017200000 } from './1790017200000-SiteScopedRoles';

describe('SiteScopedRoles1790017200000', () => {
  it('adds explicit account and site scope without granting old memberships site access', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new SiteScopedRoles1790017200000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('ADD COLUMN "site_ids" uuid[]');
    expect(sql).toContain('ADD COLUMN "account_kind"');
    expect(sql).toContain('ADD COLUMN "home_site_id"');
    expect(sql).not.toMatch(/UPDATE "workspace_memberships".*"site_ids"/s);
  });
});
