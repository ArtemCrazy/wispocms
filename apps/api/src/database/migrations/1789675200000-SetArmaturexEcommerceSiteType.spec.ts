import type { QueryRunner } from 'typeorm';
import { SetArmaturexEcommerceSiteType1789675200000 } from './1789675200000-SetArmaturexEcommerceSiteType';

type QueryCall = [statement: string, parameters?: unknown[]];

const pak = {
  id: 'a8100000-0000-4000-8000-000000000008',
  name: 'ПАК',
  slug: 'pak',
};

const armaturex = {
  id: 'a8100000-0000-4000-8000-000000000001',
  slug: 'armaturex',
  workspace_id: pak.id,
  workspace_slug: pak.slug,
  site_type: 'corporate',
  provisioning_owner: '1789502400000-armaturex-home-v1',
};

describe('SetArmaturexEcommerceSiteType1789675200000', () => {
  it('expands the canonical constraint and reclassifies only PAK Armaturex', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([armaturex])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        [{ id: armaturex.id, site_type: 'ecommerce' }],
        1,
      ]);

    await new SetArmaturexEcommerceSiteType1789675200000().up({
      query,
    } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as QueryCall[];
    expect(query).toHaveBeenCalledTimes(5);
    expect(calls[2][0]).toContain('DROP CONSTRAINT "CHK_sites_site_type"');
    expect(calls[3][0]).toContain(
      "('media', 'corporate', 'ecommerce', 'landing')",
    );
    expect(calls[4][0]).toContain('SET "site_type" = \'ecommerce\'');
    expect(calls[4][1]).toEqual([
      armaturex.id,
      armaturex.slug,
      pak.id,
      armaturex.provisioning_owner,
    ]);

    const sql = calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toMatch(
      /(UPDATE|DELETE FROM) "(pages|privacy_policy_states|media|banners)"/,
    );
    expect(sql).not.toContain('DELETE FROM');
  });

  it('only repairs the constraint when Armaturex is already ecommerce', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([{ ...armaturex, site_type: 'ecommerce' }])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await new SetArmaturexEcommerceSiteType1789675200000().up({
      query,
    } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(4);
    expect(
      (query.mock.calls as unknown as QueryCall[])
        .map(([sql]) => sql)
        .join('\n'),
    ).not.toContain('UPDATE "sites"');
  });

  it.each([
    [{ ...pak, id: 'foreign-workspace-id' }, 'workspace pak'],
    [{ ...pak, name: 'Чужое пространство' }, 'workspace pak'],
  ])('fails loudly for an unexpected PAK identity %#', async (row, message) => {
    const query = jest.fn().mockResolvedValueOnce([row]);

    await expect(
      new SetArmaturexEcommerceSiteType1789675200000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow(message);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...armaturex, workspace_id: 'foreign-workspace-id' }],
    [{ ...armaturex, workspace_slug: 'foreign' }],
    [{ ...armaturex, slug: 'foreign-site' }],
    [{ ...armaturex, provisioning_owner: 'someone-else' }],
  ])('fails loudly for unexpected Armaturex ownership %#', async (site) => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([site]);

    await expect(
      new SetArmaturexEcommerceSiteType1789675200000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('provisioned site ownership does not match');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails before DDL for an unexpected current site type', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([{ ...armaturex, site_type: 'media' }]);

    await expect(
      new SetArmaturexEcommerceSiteType1789675200000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('unexpected current site type media');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails loudly if ownership changes during the guarded update', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([armaturex])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([[], 0]);

    await expect(
      new SetArmaturexEcommerceSiteType1789675200000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('site ownership changed during migration');
  });

  it('does not mutate schema or data on down migration', async () => {
    const query = jest.fn();
    await new SetArmaturexEcommerceSiteType1789675200000().down({
      query,
    } as unknown as QueryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
