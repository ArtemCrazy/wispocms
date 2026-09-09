import type { QueryRunner } from 'typeorm';
import { SeedArmaturexHomepage1789502400000 } from './1789502400000-SeedArmaturexHomepage';

type QueryCall = [statement: string, parameters?: unknown[]];

describe('SeedArmaturexHomepage1789502400000', () => {
  it('provisions an owned draft site with every required system page and privacy state', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'workspace-id' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'legal-model-id' }])
      .mockResolvedValue(undefined);

    await new SeedArmaturexHomepage1789502400000().up({
      query,
    } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as QueryCall[];
    const sql = calls.map(([statement]) => statement).join('\n');
    const siteSql = calls[3][0];
    const homepageSql = calls[4][0];
    const systemPagesSql = calls[5][0];
    const privacyStateSql = calls[6][0];
    const blocks = JSON.parse(String(calls[4][1]?.[2])) as Array<{
      id: string;
      data?: { items?: unknown[] };
    }>;

    expect(query).toHaveBeenCalledTimes(7);
    expect(siteSql).toContain('INSERT INTO "sites"');
    expect(siteSql).not.toContain('ON CONFLICT');
    expect(siteSql).not.toContain('"domain"');
    expect(String(calls[3][1]?.[4])).toContain(
      '1789502400000-armaturex-home-v1',
    );
    expect(homepageSql).toContain("'armaturex-home-v1'");
    expect(homepageSql).toContain("'draft'");
    expect(homepageSql).not.toContain('ON CONFLICT');
    expect(systemPagesSql).toContain("'privacy-policy'");
    expect(systemPagesSql).toContain("'404'");
    expect(systemPagesSql).toContain("'thank-you'");
    expect(systemPagesSql).toContain("'capture-form'");
    expect(privacyStateSql).toContain('INSERT INTO "privacy_policy_states"');
    expect(privacyStateSql).toContain("'system-policy'");
    expect(sql).not.toContain('DO UPDATE');
    expect(
      blocks.find((block) => block.id.endsWith('-catalog'))?.data?.items,
    ).toHaveLength(12);
  });

  it('fails loudly when the required workspace is missing', async () => {
    const query = jest.fn().mockResolvedValueOnce([]);

    await expect(
      new SeedArmaturexHomepage1789502400000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('workspace crazy-studio is missing');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('preserves a pre-existing site and all of its pages on slug collision', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'workspace-id' }])
      .mockResolvedValueOnce([{ id: 'pre-existing-site-id' }]);

    await expect(
      new SeedArmaturexHomepage1789502400000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('site slug armaturex already exists');

    const sql = (query.mock.calls as unknown as QueryCall[])
      .map(([statement]) => statement)
      .join('\n');
    expect(query).toHaveBeenCalledTimes(2);
    expect(sql).not.toContain('UPDATE "sites"');
    expect(sql).not.toContain('UPDATE "pages"');
    expect(sql).not.toContain('DELETE FROM');
  });

  it('rolls back only fixed-ID child rows and never deletes a site', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new SeedArmaturexHomepage1789502400000().down({
      query,
    } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as QueryCall[];
    const sql = calls.map(([statement]) => statement).join('\n');
    expect(query).toHaveBeenCalledTimes(2);
    expect(sql).toContain('DELETE FROM "privacy_policy_states"');
    expect(sql).toContain('DELETE FROM "pages"');
    expect(sql).toContain('"id" = ANY($2::uuid[])');
    expect(sql).not.toContain('DELETE FROM "sites"');
    expect(calls[0][1]).toContain('a8100000-0000-4000-8000-000000000007');
    expect(calls[1][1]?.[1]).toEqual(
      expect.arrayContaining([
        'a8100000-0000-4000-8000-000000000002',
        'a8100000-0000-4000-8000-000000000006',
      ]),
    );
  });
});
