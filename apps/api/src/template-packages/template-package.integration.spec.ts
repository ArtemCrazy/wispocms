import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import {
  AuditLogEntity,
  ArticleActivityEntity,
  ArticleEntity,
  AuthorEntity,
  BannerEntity,
  CategoryEntity,
  MediaEntity,
  PageEntity,
  PlatformRole,
  SiteAccessEntity,
  SiteContentTemplateEntity,
  SiteEntity,
  TemplatePackageVersionEntity,
  UserEntity,
} from '../database/entities';
import { createDataSourceOptions } from '../database/data-source';
import { ContentService } from '../content/content.service';
import type { TemplatePackageManifest } from './template-package.types';
import { TemplatePackageService } from './template-package.service';

const databaseUrl = process.env.TEMPLATE_PACKAGE_TEST_DATABASE_URL;
const isolatedDatabase = process.env.WISPO_TEMPLATE_PACKAGE_ISOLATED_DB;
const integration = databaseUrl ? describe : describe.skip;
const skinovaManifestTemplate = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      '../../../web/template-packages/skinova/manifest.template.json',
    ),
    'utf8',
  ),
) as Omit<TemplatePackageManifest, 'source' | 'build'> & {
  source: Pick<TemplatePackageManifest['source'], 'repository'>;
  build: Pick<TemplatePackageManifest['build'], 'runtimeMode'>;
};

function manifestFixture(): TemplatePackageManifest {
  return {
    ...structuredClone(skinovaManifestTemplate),
    source: {
      ...skinovaManifestTemplate.source,
      revision: 'a'.repeat(40),
    },
    build: {
      ...skinovaManifestTemplate.build,
      releaseDigest: 'b'.repeat(64),
      artifactDigest: null,
      builtAt: '2026-10-03T12:00:00.000Z',
    },
  };
}

export function assertDisposableTemplatePackageDatabase(
  url: string,
  optIn: string | undefined,
) {
  const parsed = new URL(url);
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    optIn !== 'wispo_task9_tests' ||
    databaseName !== optIn ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.port !== '55439' ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    throw new Error(
      'Template package integration tests require the disposable local wispo_task9_tests database on port 55439 and explicit opt-in.',
    );
  }
}

describe('Template package integration database guard', () => {
  it.each(['?host=evil.example&port=5432', '?host=/var/run/postgresql'])(
    'rejects PostgreSQL query override %s without opening a connection',
    (query) => {
      expect(() =>
        assertDisposableTemplatePackageDatabase(
          `postgresql://test:test@127.0.0.1:55439/wispo_task9_tests${query}`,
          'wispo_task9_tests',
        ),
      ).toThrow();
    },
  );
});

integration('Template package release / isolated PostgreSQL', () => {
  let db: DataSource;
  let service: TemplatePackageService;
  let content: ContentService;

  beforeAll(async () => {
    assertDisposableTemplatePackageDatabase(databaseUrl!, isolatedDatabase);

    db = new DataSource({
      ...createDataSourceOptions(),
      url: databaseUrl,
      ssl: false,
      migrationsRun: true,
    });
    await db.initialize();
    const audit = new AuditService(
      db.getRepository(AuditLogEntity),
      db.getRepository(UserEntity),
      db.getRepository(SiteEntity),
      db.getRepository(SiteAccessEntity),
    );
    service = new TemplatePackageService(db, audit, {
      registerContractsUsingManager: jest.fn(),
    } as never);
    content = new ContentService(
      db.getRepository(SiteEntity),
      db.getRepository(SiteAccessEntity),
      db.getRepository(CategoryEntity),
      db.getRepository(AuthorEntity),
      db.getRepository(ArticleEntity),
      db.getRepository(ArticleActivityEntity),
      db.getRepository(MediaEntity),
      db.getRepository(PageEntity),
      db.getRepository(BannerEntity),
    );
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  beforeEach(async () => {
    await db.query(
      `UPDATE sites
       SET template_package_id = NULL,
           current_template_package_version_id = NULL
       WHERE slug = 'skinova'`,
    );
    await db.query(
      `UPDATE site_content_templates
       SET version = '1'
       WHERE site_id = (SELECT id FROM sites WHERE slug = 'skinova')
         AND key IN (
           'skinova-editorial', 'skinova-article', 'skinova-category',
           'skinova-header', 'skinova-footer'
         )`,
    );
    await db.query('DELETE FROM template_packages');
    await db.query(
      `DELETE FROM audit_logs WHERE actor_name = 'Release pipeline'`,
    );
  });

  async function publicSkinova() {
    const [publicSite, integrationManifest] = await Promise.all([
      content.getPublicSite('skinova'),
      content.getPublicIntegrationManifest('skinova'),
    ]);
    return {
      siteTemplatePackage: publicSite.site.templatePackage,
      manifestTemplatePackage: integrationManifest.templatePackage,
    };
  }

  async function skinovaTemplateCatalog(siteId: string) {
    const assignments = await db.getRepository(SiteContentTemplateEntity).find({
      where: { siteId },
      order: { kind: 'ASC', key: 'ASC', version: 'ASC', id: 'ASC' },
    });
    return assignments.map(
      ({
        id,
        siteId,
        kind,
        key,
        version,
        name,
        config,
        isActive,
        createdAt,
      }) => ({
        id,
        siteId,
        kind,
        key,
        version,
        name,
        config,
        isActive,
        createdAt,
      }),
    );
  }

  it('applies the complete migration ledger to the disposable empty database', async () => {
    const applied = await db.query<Array<{ name: string }>>(
      'SELECT name FROM migrations ORDER BY id',
    );
    expect(applied).toHaveLength(51);
    expect(applied.at(-2)?.name).toBe('TemplatePackageRegistry1791789600000');
    expect(applied.at(-1)?.name).toBe(
      'AssignSkinovaSystemTemplate1791793200000',
    );
  });

  it('keeps public pointers unchanged until report-deployed and handles idempotency, conflict, legacy NULL and mismatch', async () => {
    const admin = {
      userId: '00000000-0000-4000-8000-000000000001',
      platformRole: PlatformRole.WISPO_ADMIN,
    };
    const site = await db.getRepository(SiteEntity).findOneOrFail({
      where: { slug: 'skinova' },
    });
    const legacyCurrent = await service.current(site.id, admin);
    const publicBefore = await publicSkinova();
    const catalogBefore = await skinovaTemplateCatalog(site.id);
    expect(legacyCurrent.templatePackage).toBeNull();
    expect(publicBefore.siteTemplatePackage).toBeNull();
    expect(publicBefore.manifestTemplatePackage).toBeNull();

    const manifest = manifestFixture();
    const created = await service.register(manifest);
    const repeated = await service.register(structuredClone(manifest));
    expect(created).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '1',
      status: 'registered',
      created: true,
    });
    expect(repeated).toMatchObject({
      versionId: created.versionId,
      releaseDigest: created.releaseDigest,
      manifestDigest: created.manifestDigest,
      created: false,
    });
    expect(await db.getRepository(TemplatePackageVersionEntity).count()).toBe(
      1,
    );

    const conflicting = structuredClone(manifest);
    conflicting.build.releaseDigest = 'c'.repeat(64);
    await expect(service.register(conflicting)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const afterRegister = await db.getRepository(SiteEntity).findOneByOrFail({
      id: site.id,
    });
    expect(afterRegister.templatePackageId).toBeNull();
    expect(afterRegister.currentTemplatePackageVersionId).toBeNull();
    expect(await publicSkinova()).toEqual(publicBefore);
    expect(await skinovaTemplateCatalog(site.id)).toEqual(catalogBefore);

    const preflight = await service.preflight('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(preflight).toMatchObject({ status: 'ready', reasons: [] });
    const afterPreflight = await db
      .getRepository(SiteEntity)
      .findOneByOrFail({ id: site.id });
    expect(afterPreflight.templatePackageId).toBeNull();
    expect(afterPreflight.currentTemplatePackageVersionId).toBeNull();
    expect(await publicSkinova()).toEqual(publicBefore);
    expect(await skinovaTemplateCatalog(site.id)).toEqual(catalogBefore);

    const deployed = await service.reportDeployed('skinova', {
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(deployed).toMatchObject({ status: 'ready', reasons: [] });
    expect(await skinovaTemplateCatalog(site.id)).toEqual(catalogBefore);
    const current = await service.current(site.id, admin);
    expect(current.templatePackage).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '1',
      status: 'ready',
      reasons: [],
    });
    const publicAfter = await publicSkinova();
    expect(publicAfter.siteTemplatePackage).toEqual({
      packageId: 'skinova-media',
      packageVersion: '1',
    });
    expect(publicAfter.manifestTemplatePackage).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '1',
      sourceRevision: manifest.source.revision,
      releaseDigest: manifest.build.releaseDigest,
    });

    const assignment = await db
      .getRepository(SiteContentTemplateEntity)
      .findOneByOrFail({ siteId: site.id, key: 'skinova-article' });
    assignment.version = '999';
    await db.getRepository(SiteContentTemplateEntity).save(assignment);
    const mismatch = await service.current(site.id, admin);
    expect(mismatch.templatePackage).toMatchObject({
      packageId: 'skinova-media',
      packageVersion: '1',
      status: 'mismatch',
      reasons: ['template_assignment_mismatch'],
    });
    expect(
      (await db.getRepository(SiteEntity).findOneByOrFail({ id: site.id }))
        .currentTemplatePackageVersionId,
    ).toBe(created.versionId);

    const events = await db.query<Array<{ action: string; count: string }>>(
      `SELECT action, count(*)::text AS count
       FROM audit_logs
       WHERE actor_name = 'Release pipeline'
       GROUP BY action
       ORDER BY action`,
    );
    expect(events).toEqual([
      { action: 'template_package_deployed', count: '1' },
      { action: 'template_package_preflight', count: '1' },
      { action: 'template_package_registered', count: '1' },
    ]);
  });
});
