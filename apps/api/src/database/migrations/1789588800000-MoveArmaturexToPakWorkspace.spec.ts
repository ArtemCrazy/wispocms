import type { QueryRunner } from 'typeorm';
import { MoveArmaturexToPakWorkspace1789588800000 } from './1789588800000-MoveArmaturexToPakWorkspace';

type QueryCall = [statement: string, parameters?: unknown[]];

const pak = {
  id: 'a8100000-0000-4000-8000-000000000008',
  name: 'ПАК',
  slug: 'pak',
};

const provisionedSite = {
  id: 'a8100000-0000-4000-8000-000000000001',
  slug: 'armaturex',
  workspace_id: 'crazy-workspace-id',
  workspace_slug: 'crazy-studio',
  provisioning_owner: '1789502400000-armaturex-home-v1',
};

describe('MoveArmaturexToPakWorkspace1789588800000', () => {
  it('creates the PAK workspace and moves only the provisioned Armaturex site', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([provisionedSite])
      .mockResolvedValueOnce([[{ id: provisionedSite.id }], 1]);

    await new MoveArmaturexToPakWorkspace1789588800000().up({
      query,
    } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as QueryCall[];
    expect(query).toHaveBeenCalledTimes(4);
    expect(calls[1][0]).toContain('INSERT INTO "workspaces"');
    expect(calls[1][1]).toEqual([pak.id, 'ПАК', 'pak']);
    expect(calls[3][0]).toContain('UPDATE "sites"');
    expect(calls[3][1]).toEqual([
      pak.id,
      provisionedSite.id,
      'armaturex',
      'crazy-workspace-id',
      '1789502400000-armaturex-home-v1',
    ]);
    const sql = calls.map(([statement]) => statement).join('\n');
    expect(sql).not.toContain('workspace_memberships');
    expect(sql).not.toMatch(
      /(UPDATE|DELETE FROM) "(pages|privacy_policy_states|media)"/,
    );
    expect(sql).not.toContain('DELETE FROM');
  });

  it('is a no-op when the exact provisioned site is already in PAK', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([
        {
          ...provisionedSite,
          workspace_id: pak.id,
          workspace_slug: pak.slug,
        },
      ]);

    await new MoveArmaturexToPakWorkspace1789588800000().up({
      query,
    } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    expect(
      (query.mock.calls as unknown as QueryCall[])
        .map(([sql]) => sql)
        .join('\n'),
    ).not.toContain('UPDATE "sites"');
  });

  it('fails loudly when workspace pak collides with another identity', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        { id: 'foreign-workspace-id', name: 'ПАК', slug: 'pak' },
      ]);

    await expect(
      new MoveArmaturexToPakWorkspace1789588800000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('workspace pak has an unexpected identity or name');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('fails loudly for a foreign site at the fixed Armaturex id', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([
        { ...provisionedSite, provisioning_owner: 'someone-else' },
      ]);

    await expect(
      new MoveArmaturexToPakWorkspace1789588800000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('provisioned site identity does not match');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails loudly when Armaturex currently belongs to another workspace', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([pak])
      .mockResolvedValueOnce([
        {
          ...provisionedSite,
          workspace_id: 'foreign-workspace-id',
          workspace_slug: 'foreign-owner',
        },
      ]);

    await expect(
      new MoveArmaturexToPakWorkspace1789588800000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('unexpected current workspace foreign-owner');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('does not mutate data on down migration', async () => {
    const query = jest.fn();
    await new MoveArmaturexToPakWorkspace1789588800000().down({
      query,
    } as unknown as QueryRunner);

    expect(query).not.toHaveBeenCalled();
  });
});
