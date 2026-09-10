import type { QueryRunner } from 'typeorm';
import { CanonicalBannerSlots1789934400000 } from './1789934400000-CanonicalBannerSlots';

describe('CanonicalBannerSlots1789934400000', () => {
  it('enforces site ownership and backfills Skinova assignments without copying banner data', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new CanonicalBannerSlots1789934400000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('cross-site rows exist');
    expect(sql).toContain('FK_page_banner_assignments_page_site');
    expect(sql).toContain('FK_page_banner_assignments_banner_site');
    expect(sql).toContain(`page."system_template_key" = 'skinova-home'`);
    expect(sql).toContain('ON CONFLICT ("page_id", "zone") DO NOTHING');
    expect(sql).not.toMatch(/UPDATE "banners"|DELETE FROM "banners"/);
  });
});
