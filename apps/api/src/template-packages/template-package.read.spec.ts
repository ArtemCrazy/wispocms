import { ForbiddenException } from '@nestjs/common';
import {
  ContentTemplateKind,
  PlatformRole,
  SiteAccessEntity,
  SiteContentTemplateEntity,
  SiteEntity,
  SiteRole,
  SiteType,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import type { TemplatePackageManifest } from './template-package.types';
import { TemplatePackageService } from './template-package.service';

const manifest = {
  manifestVersion: 1,
  packageId: 'skinova-media',
  packageVersion: '1',
  title: 'Skinova Media',
  siteType: 'media',
  cmsApi: { minSchemaVersion: '1.2' },
  source: {
    repository: 'https://github.com/example/skinova.git',
    revision: '0123456789abcdef0123456789abcdef01234567',
  },
  build: {
    releaseDigest: 'a'.repeat(64),
    artifactDigest: null,
    builtAt: '2026-10-02T09:30:00Z',
    runtimeMode: 'embedded-next',
  },
  templates: [
    {
      kind: 'article',
      key: 'skinova-article',
      version: '1',
      title: 'Article',
      dataScope: 'cms-entity',
      runtimeContext: [],
      dataSchemaVersion: '1',
      dataSchema: { type: 'object' },
    },
  ],
} as TemplatePackageManifest;

function createHarness(options?: {
  accessRole?: SiteRole;
  sitePackageId?: string | null;
  currentVersionId?: string | null;
  assignments?: Array<
    Pick<SiteContentTemplateEntity, 'kind' | 'key' | 'version'>
  >;
}) {
  const templatePackage = {
    id: 'package-1',
    packageId: manifest.packageId,
    title: manifest.title,
    siteType: SiteType.MEDIA,
    repositoryUrl: manifest.source.repository,
  } as TemplatePackageEntity;
  const currentVersion = {
    id: 'version-1',
    templatePackageId: templatePackage.id,
    packageVersion: '1',
    sourceRevision: manifest.source.revision,
    releaseDigest: manifest.build.releaseDigest,
    artifactDigest: null,
    manifest,
    runtimeMode: 'embedded-next',
    runtimeUrl: null,
    builtAt: new Date(manifest.build.builtAt),
  } as unknown as TemplatePackageVersionEntity;
  const externalVersion = {
    ...currentVersion,
    id: 'version-2',
    packageVersion: '2',
    releaseDigest: 'b'.repeat(64),
    runtimeMode: 'external',
    runtimeUrl: 'https://preview.example.com/releases/skinova-v2',
  } as TemplatePackageVersionEntity;
  const embeddedCandidate = {
    ...currentVersion,
    id: 'version-3',
    packageVersion: '3',
    releaseDigest: 'c'.repeat(64),
  };
  const incompatibleCandidate = {
    ...externalVersion,
    id: 'version-4',
    packageVersion: '4',
    releaseDigest: 'd'.repeat(64),
    runtimeUrl: 'https://preview.example.com/releases/skinova-v4',
    manifest: { ...manifest, packageVersion: '4', templates: [] },
  } as TemplatePackageVersionEntity;
  const site = {
    id: 'site-id',
    workspaceId: 'workspace-id',
    slug: 'skinova',
    siteType: SiteType.MEDIA,
    templatePackageId:
      options?.sitePackageId === undefined
        ? templatePackage.id
        : options.sitePackageId,
    currentTemplatePackageVersionId:
      options?.currentVersionId === undefined
        ? currentVersion.id
        : options.currentVersionId,
  } as SiteEntity;
  const assignments = (options?.assignments ?? [
    { kind: 'article', key: 'skinova-article', version: '1' },
  ]) as SiteContentTemplateEntity[];
  const access = options?.accessRole
    ? ({
        userId: 'owner-id',
        siteId: site.id,
        role: options.accessRole,
        requiresApproval: false,
      } as SiteAccessEntity)
    : null;
  const versions = [
    currentVersion,
    externalVersion,
    embeddedCandidate,
    incompatibleCandidate,
  ];
  const repositories = new Map<unknown, Record<string, jest.Mock>>([
    [
      SiteEntity,
      {
        findOne: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === site.id ? site : null),
        ),
      },
    ],
    [
      SiteAccessEntity,
      {
        findOne: jest.fn(
          ({ where }: { where: { userId: string; siteId: string } }) =>
            Promise.resolve(
              access &&
                access.userId === where.userId &&
                access.siteId === where.siteId
                ? access
                : null,
            ),
        ),
      },
    ],
    [
      TemplatePackageEntity,
      {
        findOne: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === templatePackage.id ? templatePackage : null,
          ),
        ),
      },
    ],
    [
      TemplatePackageVersionEntity,
      {
        findOne: jest.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(
            versions.find((version) => version.id === where.id) ?? null,
          ),
        ),
        find: jest.fn(({ where }: { where: { templatePackageId: string } }) =>
          Promise.resolve(
            versions.filter(
              (version) =>
                version.templatePackageId === where.templatePackageId,
            ),
          ),
        ),
      },
    ],
    [
      SiteContentTemplateEntity,
      {
        find: jest.fn().mockResolvedValue(assignments),
      },
    ],
  ]);
  const dataSource = {
    getRepository: jest.fn((entity: unknown) => repositories.get(entity)),
  };
  const audit = { recordSystemEvent: jest.fn() };
  return {
    service: new TemplatePackageService(dataSource as never, audit as never),
    audit,
  };
}

describe('TemplatePackageService read-only release state', () => {
  const admin = {
    userId: 'admin-id',
    platformRole: PlatformRole.WISPO_ADMIN,
  };
  const owner = {
    userId: 'owner-id',
    platformRole: PlatformRole.EMPLOYEE,
  };

  it('returns a safe current summary for the actually deployed pointer', async () => {
    const { service, audit } = createHarness({ accessRole: SiteRole.OWNER });

    await expect(service.current('site-id', owner)).resolves.toMatchObject({
      siteId: 'site-id',
      siteSlug: 'skinova',
      templatePackage: {
        packageId: 'skinova-media',
        packageVersion: '1',
        sourceRevision: '0123456789abcdef0123456789abcdef01234567',
        releaseDigest: 'a'.repeat(64),
        artifactDigest: null,
        status: 'ready',
        reasons: [],
        previewUrl: '/preview/skinova',
        templates: [{ kind: 'article', key: 'skinova-article', version: '1' }],
      },
    });
    expect(audit.recordSystemEvent).not.toHaveBeenCalled();
  });

  it('preserves legacy sites as a nullable current package', async () => {
    const { service } = createHarness({
      sitePackageId: null,
      currentVersionId: null,
    });

    await expect(service.current('site-id', admin)).resolves.toEqual({
      siteId: 'site-id',
      siteSlug: 'skinova',
      templatePackage: null,
    });
    await expect(service.candidates('site-id', admin)).resolves.toEqual([]);
  });

  it('denies current state to a content manager and an owner of another site', async () => {
    const managerHarness = createHarness({
      accessRole: SiteRole.CONTENT_MANAGER,
    });
    const outsiderHarness = createHarness();

    await expect(
      managerHarness.service.current('site-id', owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      outsiderHarness.service.current('site-id', owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only compatible registered candidates with server preview URLs', async () => {
    const { service, audit } = createHarness();

    const candidates = await service.candidates('site-id', admin);

    expect(
      candidates.map(({ packageVersion, status, isCurrent, previewUrl }) => ({
        packageVersion,
        status,
        isCurrent,
        previewUrl,
      })),
    ).toEqual([
      {
        packageVersion: '1',
        status: 'registered',
        isCurrent: true,
        previewUrl: '/preview/skinova',
      },
      {
        packageVersion: '2',
        status: 'registered',
        isCurrent: false,
        previewUrl: 'https://preview.example.com/releases/skinova-v2',
      },
      {
        packageVersion: '3',
        status: 'registered',
        isCurrent: false,
        previewUrl: null,
      },
    ]);
    expect(candidates).toHaveLength(3);
    expect(
      candidates.some(({ packageVersion }) => packageVersion === '4'),
    ).toBe(false);
    expect(candidates.every((candidate) => !('reasons' in candidate))).toBe(
      true,
    );
    await expect(service.candidates('site-id', owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(audit.recordSystemEvent).not.toHaveBeenCalled();
  });

  it('surfaces mismatch reasons from the deployed version without changing it', async () => {
    const { service } = createHarness({
      assignments: [
        {
          kind: ContentTemplateKind.ARTICLE,
          key: 'unknown-article',
          version: '1',
        },
      ],
    });

    await expect(service.current('site-id', admin)).resolves.toMatchObject({
      templatePackage: {
        packageVersion: '1',
        status: 'mismatch',
        reasons: ['template_assignment_mismatch'],
      },
    });
  });
});
