import type { QueryRunner } from 'typeorm';
import { SeedArmaturexHomepage1789502400000 } from './1789502400000-SeedArmaturexHomepage';

describe('SeedArmaturexHomepage1789502400000', () => {
  it('idempotently seeds the versioned draft homepage in Crazy Studio', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'workspace-id' }])
      .mockResolvedValueOnce([{ id: 'site-id' }])
      .mockResolvedValueOnce(undefined);

    await new SeedArmaturexHomepage1789502400000().up({
      query,
    } as unknown as QueryRunner);

    const calls = query.mock.calls as unknown as Array<
      [statement: string, parameters?: unknown[]]
    >;
    const siteSql = calls[1][0];
    const pageSql = calls[2][0];
    const blocks = JSON.parse(String(calls[2][1]?.[1])) as Array<{
      id: string;
      data?: { items?: unknown[] };
    }>;

    expect(siteSql).toContain('ON CONFLICT ("workspace_id", "slug") DO UPDATE');
    expect(siteSql).not.toContain('"domain"');
    expect(pageSql).toContain("'armaturex-home-v1'");
    expect(pageSql).toContain("'draft'");
    expect(pageSql).toContain('ON CONFLICT ("site_id", "slug") DO UPDATE');
    expect(
      blocks.find((block) => block.id.endsWith('-catalog'))?.data?.items,
    ).toHaveLength(12);
  });

  it('fails before page mutation when the site upsert returns no id', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'workspace-id' }])
      .mockResolvedValueOnce([]);

    await expect(
      new SeedArmaturexHomepage1789502400000().up({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('site upsert returned no id');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
