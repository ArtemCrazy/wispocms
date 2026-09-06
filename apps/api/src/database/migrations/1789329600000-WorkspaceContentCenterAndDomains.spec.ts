import type { QueryRunner } from 'typeorm';
import { WorkspaceContentCenterAndDomains1789329600000 } from './1789329600000-WorkspaceContentCenterAndDomains';

describe('WorkspaceContentCenterAndDomains1789329600000', () => {
  it('backfills workspace ownership without moving existing media files', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new WorkspaceContentCenterAndDomains1789329600000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain('ADD COLUMN "workspace_id" uuid');
    expect(sql).toContain('"storage_namespace" = media."site_id"::text');
    expect(sql).toContain('FK_media_workspace');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('UQ_sites_domain_ci');
    expect(sql).toContain('linked_commercial_site_id');
    expect(sql).not.toContain('DELETE FROM');
  });

  it('defines an explicit rollback for every added contract', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new WorkspaceContentCenterAndDomains1789329600000().down({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain('DROP COLUMN "workspace_id"');
    expect(sql).toContain('DROP INDEX "UQ_sites_domain_ci"');
    expect(sql).toContain('DROP COLUMN "linked_commercial_site_id"');
  });
});
