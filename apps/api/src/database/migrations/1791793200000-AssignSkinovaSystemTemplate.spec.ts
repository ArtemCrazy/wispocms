import { createDataSourceOptions } from '../data-source';
import { AssignSkinovaSystemTemplate1791793200000 } from './1791793200000-AssignSkinovaSystemTemplate';

describe('AssignSkinovaSystemTemplate migration', () => {
  it('is registered after the package registry migration', () => {
    const migrations = createDataSourceOptions().migrations as Array<
      new () => { name?: string }
    >;
    const names = migrations.map(
      (Migration) => new Migration().name || Migration.name,
    );

    expect(names.indexOf('AssignSkinovaSystemTemplate1791793200000')).toBe(
      names.indexOf('TemplatePackageRegistry1791789600000') + 1,
    );
  });

  it('assigns skinova@1 only to the exact imported blank privacy page', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AssignSkinovaSystemTemplate1791793200000().up({ query } as never);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      '51a40000-0000-4000-8000-000000000002',
      '51a00000-0000-4000-8000-000000000002',
      'privacy-policy',
      'skinova',
      'skinova',
      '1',
    ]);
    expect(sql).toContain('"system_template_key" IS NULL');
    expect(sql).toContain('"system_template_version" IS NULL');
    expect(sql).toContain('"published_system_template_key" IS NULL');
    expect(sql).toContain('"published_system_template_version" IS NULL');
    expect(sql).toContain('"id" = $1');
    expect(sql).toContain('"site_id" = $2');
    expect(sql).toContain('"slug" = $3');
    expect(sql).toContain('site."slug" = $4');
  });

  it('rolls back only the exact values assigned by this migration', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new AssignSkinovaSystemTemplate1791793200000().down({
      query,
    } as never);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([
      '51a40000-0000-4000-8000-000000000002',
      '51a00000-0000-4000-8000-000000000002',
      'privacy-policy',
      'skinova',
      'skinova',
      '1',
    ]);
    expect(sql).toContain('"system_template_key" = $5');
    expect(sql).toContain('"system_template_version" = $6');
    expect(sql).toContain('"published_system_template_key" = $5');
    expect(sql).toContain('"published_system_template_version" = $6');
    expect(sql).toContain('SET "system_template_key" = NULL');
  });
});
