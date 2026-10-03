import { getMetadataArgsStorage } from 'typeorm';
import { createDataSourceOptions } from '../data-source';
import {
  ContentTemplateKind,
  databaseEntities,
  SiteEntity,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../entities';
import { TemplatePackageRegistry1791789600000 } from './1791789600000-TemplatePackageRegistry';

describe('TemplatePackageRegistry migration', () => {
  it('is registered together with both registry entities', () => {
    const options = createDataSourceOptions();

    expect(options.migrations).toContain(TemplatePackageRegistry1791789600000);
    expect(databaseEntities).toEqual(
      expect.arrayContaining([
        TemplatePackageEntity,
        TemplatePackageVersionEntity,
      ]),
    );
  });

  it('exposes the new catalog kinds and nullable site release pointers', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      ({ target }) => target === SiteEntity,
    );
    const byProperty = new Map(
      columns.map(({ propertyName, options }) => [propertyName, options]),
    );

    expect(ContentTemplateKind.HOMEPAGE).toBe('homepage');
    expect(ContentTemplateKind.SYSTEM_PAGE).toBe('system_page');
    expect(byProperty.get('templatePackageId')).toMatchObject({
      name: 'template_package_id',
      type: 'uuid',
      nullable: true,
    });
    expect(byProperty.get('currentTemplatePackageVersionId')).toMatchObject({
      name: 'current_template_package_version_id',
      type: 'uuid',
      nullable: true,
    });
  });

  it('creates an additive immutable registry without backfilling a release', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new TemplatePackageRegistry1791789600000().up({ query } as never);

    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain('CREATE TABLE "template_packages"');
    expect(sql).toContain('CREATE TABLE "template_package_versions"');
    expect(sql).toContain('UNIQUE ("template_package_id", "package_version")');
    expect(sql).toContain('UNIQUE ("id", "template_package_id")');
    expect(sql).toContain('ADD "template_package_id" uuid');
    expect(sql).toContain('ADD "current_template_package_version_id" uuid');
    expect(sql).toContain(
      'CHECK ("current_template_package_version_id" IS NULL OR "template_package_id" IS NOT NULL)',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("current_template_package_version_id", "template_package_id")',
    );
    expect(sql).toContain(
      'REFERENCES "template_package_versions"("id", "template_package_id")',
    );
    expect(sql).toContain(
      'CREATE TRIGGER "TRG_template_package_versions_immutable"',
    );
    expect(sql).toContain('CHECK ("manifest_version" = 1)');
    expect(sql).toContain("'homepage'");
    expect(sql).toContain("'system_page'");
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
    expect(sql).not.toContain('skinova');
  });

  it('removes only the new dependencies in reverse order on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new TemplatePackageRegistry1791789600000().down({ query } as never);

    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toMatch(/END;\s*\$\$/);
    expect(sql).toContain('DROP COLUMN "current_template_package_version_id"');
    expect(sql).toContain('DROP COLUMN "template_package_id"');
    expect(sql).toContain('DROP TABLE "template_package_versions"');
    expect(sql).toContain('DROP TABLE "template_packages"');
    expect(sql).not.toMatch(/DROP TABLE "sites"|DELETE FROM/i);
  });
});
