import type { QueryRunner } from 'typeorm';
import { ExpandMediaSiteToolkit1789761600000 } from './1789761600000-ExpandMediaSiteToolkit';

describe('ExpandMediaSiteToolkit1789761600000', () => {
  it('adds the toolkit and deterministically maps legacy homepage placements', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ExpandMediaSiteToolkit1789761600000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');

    expect(sql).toContain('CREATE TABLE "page_banner_assignments"');
    expect(sql).toContain('CREATE TABLE "site_variables"');
    expect(sql).toContain('CREATE TABLE "site_search_settings"');
    expect(sql).toContain('CREATE TABLE "page_activities"');
    expect(sql).toContain(`'category', 'header', 'footer'`);
    expect(sql).toContain(`('header', 'standard-header'`);
    expect(sql).toContain(`('footer', 'standard-footer'`);
    expect(sql).toContain(`'headerTemplateKey', 'standard-header'`);
    expect(sql).toContain('INSERT INTO "article_section_settings"');
    expect(sql).toContain('SELECT DISTINCT ON (page."id", banner."placement")');
    expect(sql).toContain(`site."site_type" = 'media'`);
    expect(sql).toContain('banner."is_active" DESC');
    expect(sql).not.toMatch(
      /DELETE FROM "(banners|pages|articles|categories)"/,
    );
    expect(sql).not.toMatch(/UPDATE "(banners|pages|articles|categories)"/);
  });

  it('refuses an unsafe down migration before mutating schema', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ count: '1' }]);
    await expect(
      new ExpandMediaSiteToolkit1789761600000().down({
        query,
      } as unknown as QueryRunner),
    ).rejects.toThrow('user-authored toolkit data exists');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('allows down only when every banner has a legacy placement', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValue(undefined);
    await new ExpandMediaSiteToolkit1789761600000().down({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('DROP TABLE "page_banner_assignments"');
    expect(sql).toContain('ALTER COLUMN "placement" SET NOT NULL');
  });
});
