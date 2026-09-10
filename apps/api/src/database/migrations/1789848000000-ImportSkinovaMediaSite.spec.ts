import { ImportSkinovaMediaSite1789848000000 } from './1789848000000-ImportSkinovaMediaSite';

describe('ImportSkinovaMediaSite1789848000000', () => {
  it('uses existing Media contracts and preserves an independent identity', async () => {
    const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
    const queryRunner = {
      query: jest.fn((sql: string, parameters?: unknown[]) => {
        calls.push({ sql, parameters });
        if (sql.includes('FROM "workspaces"')) return [];
        if (sql.includes('FROM "sites"')) return [];
        return [];
      }),
    };

    await new ImportSkinovaMediaSite1789848000000().up(queryRunner as never);

    const sql = calls.map((call) => call.sql).join('\n');
    const parameters = calls.flatMap((call) => call.parameters ?? []);
    expect(parameters).toContain('Luminava');
    expect(parameters).toContain('Skinova');
    expect(parameters).toContain('skinova');
    expect(sql).toContain('"site_type"');
    expect(parameters).toContain('skinova-home');
    expect(parameters).toContain('skinova-article');
    expect(parameters).toContain('skinova-category');
    expect(parameters).toContain('skinova-header');
    expect(parameters).toContain('skinova-footer');
    expect(sql).toContain('"page_banner_assignments"');
    expect(sql).toContain('"site_variables"');
    expect(sql).toContain('"site_search_settings"');
    expect(sql).toContain('"article_activities"');
    expect(sql).toContain('"category_activities"');
    expect(sql).toContain('"page_activities"');
    expect(sql).toContain("'status_changed'");
    expect(parameters).toContain(
      'Skinova — о коже, косметологии и эстетической медицине',
    );
    expect(parameters).toContainEqual(
      expect.stringContaining('"dateLabel":"2026-05-15T'),
    );
  });

  it('refuses to take over a conflicting workspace', async () => {
    const queryRunner = {
      query: jest.fn((sql: string) =>
        sql.includes('FROM "workspaces"')
          ? [{ id: 'someone-else', name: 'Luminava', slug: 'luminava' }]
          : [],
      ),
    };

    await expect(
      new ImportSkinovaMediaSite1789848000000().up(queryRunner as never),
    ).rejects.toThrow('workspace identity conflicts');
  });
});
