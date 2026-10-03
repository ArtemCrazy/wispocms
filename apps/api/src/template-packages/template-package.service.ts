import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import {
  AuditService,
  type TemplatePackageAuditReason,
} from '../audit/audit.service';
import {
  SiteContentTemplateEntity,
  SiteAccessEntity,
  SiteEntity,
  PlatformRole,
  SiteType,
  TemplatePackageEntity,
  TemplatePackageVersionEntity,
} from '../database/entities';
import {
  accessCoversSite,
  hasSitePermission,
  SitePermission,
} from '../content/content.permissions';
import type { TemplatePackageManifest } from './template-package.types';
import { assertValidTemplatePackageManifest } from './template-package.validation';

export type TemplatePackageVersionReference = {
  packageId: string;
  packageVersion: string;
};

export type TemplatePackageCompatibilityStatus = 'ready' | 'mismatch';

type TemplatePackageReadActor = {
  userId: string;
  platformRole: PlatformRole;
};

const EMBEDDED_RUNTIME_VERSIONS = new Set(['skinova-media@1']);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalManifestDigest(manifest: TemplatePackageManifest) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(manifest)), 'utf8')
    .digest('hex');
}

function runtimeIsAvailable(
  templatePackage: TemplatePackageEntity,
  version: TemplatePackageVersionEntity,
) {
  if (version.runtimeMode === 'external') return Boolean(version.runtimeUrl);
  return EMBEDDED_RUNTIME_VERSIONS.has(
    `${templatePackage.packageId}@${version.packageVersion}`,
  );
}

function templateIdentities(manifest: TemplatePackageManifest) {
  return manifest.templates.map(({ kind, key, version }) => ({
    kind,
    key,
    version,
  }));
}

function isPostgresUniqueViolation(error: unknown): error is QueryFailedError {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as { code?: unknown } | undefined;
  return driverError?.code === '23505';
}

@Injectable()
export class TemplatePackageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async register(input: unknown) {
    const manifest = assertValidTemplatePackageManifest(input);
    const manifestDigest = canonicalManifestDigest(manifest);
    let result: RegistrationResult;
    try {
      result = await this.dataSource.transaction((manager) =>
        this.registerCandidate(manager, manifest, manifestDigest),
      );
    } catch (firstError) {
      if (!isPostgresUniqueViolation(firstError)) throw firstError;
      try {
        result = await this.dataSource.transaction((manager) =>
          this.registerCandidate(manager, manifest, manifestDigest),
        );
      } catch (secondError) {
        if (!isPostgresUniqueViolation(secondError)) throw secondError;
        result = await this.dataSource.transaction((manager) =>
          this.resolveRegistrationRace(
            manager,
            manifest,
            manifestDigest,
            secondError,
          ),
        );
      }
    }
    return {
      packageId: result.templatePackage.packageId,
      packageVersion: result.version.packageVersion,
      versionId: result.version.id,
      releaseDigest: result.version.releaseDigest,
      manifestDigest: result.version.manifestDigest,
      status: 'registered' as const,
      created: result.created,
    };
  }

  private async registerCandidate(
    manager: EntityManager,
    manifest: TemplatePackageManifest,
    manifestDigest: string,
  ): Promise<RegistrationResult> {
    const packages = manager.getRepository(TemplatePackageEntity);
    const versions = manager.getRepository(TemplatePackageVersionEntity);
    let templatePackage = await packages.findOne({
      where: { packageId: manifest.packageId },
    });

    if (!templatePackage) {
      templatePackage = await packages.save(
        packages.create({
          packageId: manifest.packageId,
          title: manifest.title,
          siteType: manifest.siteType as SiteType,
          repositoryUrl: manifest.source.repository,
        }),
      );
    } else {
      this.assertPackageIdentity(templatePackage, manifest);
    }

    const existing = await versions.findOne({
      where: {
        templatePackageId: templatePackage.id,
        packageVersion: manifest.packageVersion,
      },
    });
    if (existing) {
      this.assertVersionIdentity(existing, manifest, manifestDigest);
      return { templatePackage, version: existing, created: false };
    }

    const version = await versions.save(
      versions.create({
        templatePackageId: templatePackage.id,
        packageVersion: manifest.packageVersion,
        sourceRevision: manifest.source.revision,
        releaseDigest: manifest.build.releaseDigest,
        artifactDigest: manifest.build.artifactDigest ?? null,
        manifestDigest,
        manifestVersion: manifest.manifestVersion,
        manifest: manifest as unknown as Record<string, unknown>,
        cmsApiMinSchemaVersion: manifest.cmsApi.minSchemaVersion,
        cmsApiMaxSchemaVersion: manifest.cmsApi.maxSchemaVersion ?? null,
        builtAt: new Date(manifest.build.builtAt),
        runtimeMode: manifest.build.runtimeMode,
        runtimeUrl: manifest.build.runtimeUrl ?? null,
      }),
    );
    await this.auditService.recordSystemEvent(
      this.registrationAuditEvent(templatePackage, version),
      manager,
    );
    return { templatePackage, version, created: true };
  }

  private async resolveRegistrationRace(
    manager: EntityManager,
    manifest: TemplatePackageManifest,
    manifestDigest: string,
    uniqueViolation: QueryFailedError,
  ): Promise<RegistrationResult> {
    const templatePackage = await manager
      .getRepository(TemplatePackageEntity)
      .findOne({ where: { packageId: manifest.packageId } });
    if (!templatePackage) throw uniqueViolation;
    this.assertPackageIdentity(templatePackage, manifest);
    const version = await manager
      .getRepository(TemplatePackageVersionEntity)
      .findOne({
        where: {
          templatePackageId: templatePackage.id,
          packageVersion: manifest.packageVersion,
        },
      });
    if (!version) throw uniqueViolation;
    this.assertVersionIdentity(version, manifest, manifestDigest);
    return { templatePackage, version, created: false };
  }

  private assertPackageIdentity(
    templatePackage: TemplatePackageEntity,
    manifest: TemplatePackageManifest,
  ) {
    if (
      String(templatePackage.siteType) !== manifest.siteType ||
      templatePackage.repositoryUrl !== manifest.source.repository
    ) {
      throw new ConflictException(
        'Идентичность зарегистрированного frontend-пакета не совпадает',
      );
    }
  }

  private assertVersionIdentity(
    version: TemplatePackageVersionEntity,
    manifest: TemplatePackageManifest,
    manifestDigest: string,
  ) {
    if (
      version.releaseDigest !== manifest.build.releaseDigest ||
      version.manifestDigest !== manifestDigest
    ) {
      throw new ConflictException(
        'Эта версия frontend-пакета уже зарегистрирована с другим содержимым',
      );
    }
  }

  private registrationAuditEvent(
    templatePackage: TemplatePackageEntity,
    version: TemplatePackageVersionEntity,
  ) {
    return {
      event: 'template_package_registered' as const,
      entityId: version.id,
      packageId: templatePackage.packageId,
      packageVersion: version.packageVersion,
      releaseDigest: version.releaseDigest,
      status: 'registered' as const,
      reasons: [],
    };
  }

  async preflight(
    siteSlug: string,
    reference: TemplatePackageVersionReference,
  ) {
    const result = await this.dataSource.transaction((manager) =>
      this.evaluate(manager, siteSlug, reference),
    );
    await this.auditService.recordSystemEvent({
      event: 'template_package_preflight',
      entityId: result.versionId,
      workspaceId: result.workspaceId,
      siteId: result.siteId,
      packageId: result.packageId,
      packageVersion: result.packageVersion,
      releaseDigest: result.releaseDigest,
      status: result.status,
      reasons: result.reasons,
    });
    return this.publicCompatibility(result);
  }

  async reportDeployed(
    siteSlug: string,
    reference: TemplatePackageVersionReference,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      const evaluated = await this.evaluate(manager, siteSlug, reference, true);
      if (
        evaluated.site.templatePackageId !== evaluated.templatePackage.id ||
        evaluated.site.currentTemplatePackageVersionId !== evaluated.version.id
      ) {
        evaluated.site.templatePackageId = evaluated.templatePackage.id;
        evaluated.site.currentTemplatePackageVersionId = evaluated.version.id;
        await manager.getRepository(SiteEntity).save(evaluated.site);
        await this.auditService.recordSystemEvent(
          {
            event: 'template_package_deployed',
            entityId: evaluated.versionId,
            workspaceId: evaluated.workspaceId,
            siteId: evaluated.siteId,
            packageId: evaluated.packageId,
            packageVersion: evaluated.packageVersion,
            releaseDigest: evaluated.releaseDigest,
            status: evaluated.status,
            reasons: evaluated.reasons,
          },
          manager,
        );
      }
      return evaluated;
    });
    return this.publicCompatibility(result);
  }

  async current(siteId: string, actor: TemplatePackageReadActor) {
    const site = await this.requireReleaseReadSite(siteId, actor);
    if (!site.templatePackageId || !site.currentTemplatePackageVersionId)
      return { siteId: site.id, siteSlug: site.slug, templatePackage: null };

    const templatePackage = await this.dataSource
      .getRepository(TemplatePackageEntity)
      .findOne({ where: { id: site.templatePackageId } });
    const version = await this.dataSource
      .getRepository(TemplatePackageVersionEntity)
      .findOne({
        where: {
          id: site.currentTemplatePackageVersionId,
          templatePackageId: site.templatePackageId,
        },
      });
    if (!templatePackage || !version)
      throw new NotFoundException('Текущая версия frontend-пакета не найдена');
    const assignments = await this.activeAssignments(site.id);
    return {
      siteId: site.id,
      siteSlug: site.slug,
      templatePackage: this.currentSummary(
        site,
        templatePackage,
        version,
        assignments,
      ),
    };
  }

  async candidates(siteId: string, actor: TemplatePackageReadActor) {
    if (actor.platformRole !== PlatformRole.WISPO_ADMIN)
      throw new ForbiddenException('Недостаточно прав для этого действия');
    const site = await this.findSite(siteId);
    if (!site.templatePackageId) return [];
    const templatePackage = await this.dataSource
      .getRepository(TemplatePackageEntity)
      .findOne({ where: { id: site.templatePackageId } });
    if (!templatePackage)
      throw new NotFoundException('Frontend-пакет не зарегистрирован');
    const [versions, assignments] = await Promise.all([
      this.dataSource.getRepository(TemplatePackageVersionEntity).find({
        where: { templatePackageId: site.templatePackageId },
        order: { createdAt: 'ASC' },
      }),
      this.activeAssignments(site.id),
    ]);
    return versions.flatMap((version) => {
      const reasons = this.compatibilityReasons(
        site,
        templatePackage,
        version,
        assignments,
        false,
      );
      return reasons.length
        ? []
        : [this.candidateSummary(site, templatePackage, version)];
    });
  }

  private async findSite(siteId: string) {
    const site = await this.dataSource
      .getRepository(SiteEntity)
      .findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Сайт не найден');
    return site;
  }

  private async requireReleaseReadSite(
    siteId: string,
    actor: TemplatePackageReadActor,
  ) {
    const site = await this.findSite(siteId);
    if (actor.platformRole === PlatformRole.WISPO_ADMIN) return site;
    const access = await this.dataSource
      .getRepository(SiteAccessEntity)
      .findOne({ where: { userId: actor.userId, siteId } });
    if (
      !accessCoversSite(access, siteId) ||
      !hasSitePermission(
        actor.platformRole,
        access,
        SitePermission.MANAGE_STRUCTURE,
      )
    )
      throw new ForbiddenException('Недостаточно прав для этого действия');
    return site;
  }

  private activeAssignments(siteId: string) {
    return this.dataSource
      .getRepository(SiteContentTemplateEntity)
      .find({ where: { siteId, isActive: true } });
  }

  private compatibilityReasons(
    site: SiteEntity,
    templatePackage: TemplatePackageEntity,
    version: TemplatePackageVersionEntity,
    assignments: SiteContentTemplateEntity[],
    includeRuntime = true,
  ) {
    const manifest = version.manifest as unknown as TemplatePackageManifest;
    const manifestAssignments = new Set(
      manifest.templates.map(
        (template) => `${template.kind}:${template.key}@${template.version}`,
      ),
    );
    const reasons: TemplatePackageAuditReason[] = [];
    if (site.siteType !== templatePackage.siteType)
      reasons.push('site_type_mismatch');
    if (
      assignments.some(
        (assignment) =>
          !manifestAssignments.has(
            `${assignment.kind}:${assignment.key}@${assignment.version}`,
          ),
      )
    )
      reasons.push('template_assignment_mismatch');
    if (includeRuntime && !runtimeIsAvailable(templatePackage, version))
      reasons.push('runtime_unavailable');
    return reasons;
  }

  private currentSummary(
    site: SiteEntity,
    templatePackage: TemplatePackageEntity,
    version: TemplatePackageVersionEntity,
    assignments: SiteContentTemplateEntity[],
  ) {
    const manifest = version.manifest as unknown as TemplatePackageManifest;
    const reasons = this.compatibilityReasons(
      site,
      templatePackage,
      version,
      assignments,
    );
    return {
      packageId: templatePackage.packageId,
      packageVersion: version.packageVersion,
      sourceRevision: version.sourceRevision,
      releaseDigest: version.releaseDigest,
      artifactDigest: version.artifactDigest,
      status: reasons.length ? ('mismatch' as const) : ('ready' as const),
      reasons,
      previewUrl:
        version.runtimeMode === 'external'
          ? version.runtimeUrl
          : runtimeIsAvailable(templatePackage, version)
            ? `/preview/${encodeURIComponent(site.slug)}`
            : null,
      templates: templateIdentities(manifest),
    };
  }

  private candidateSummary(
    site: SiteEntity,
    templatePackage: TemplatePackageEntity,
    version: TemplatePackageVersionEntity,
  ) {
    const isCurrent =
      site.currentTemplatePackageVersionId === version.id &&
      site.templatePackageId === templatePackage.id;
    return {
      packageId: templatePackage.packageId,
      packageVersion: version.packageVersion,
      sourceRevision: version.sourceRevision,
      releaseDigest: version.releaseDigest,
      artifactDigest: version.artifactDigest,
      status: 'registered' as const,
      isCurrent,
      previewUrl:
        version.runtimeMode === 'external'
          ? version.runtimeUrl
          : isCurrent && runtimeIsAvailable(templatePackage, version)
            ? `/preview/${encodeURIComponent(site.slug)}`
            : null,
    };
  }

  private publicCompatibility(result: CompatibilityEvaluation) {
    return {
      siteSlug: result.site.slug,
      packageId: result.packageId,
      packageVersion: result.packageVersion,
      versionId: result.versionId,
      releaseDigest: result.releaseDigest,
      status: result.status,
      reasons: result.reasons,
    };
  }

  private async evaluate(
    manager: EntityManager,
    siteSlug: string,
    reference: TemplatePackageVersionReference,
    lockSite = false,
  ): Promise<CompatibilityEvaluation> {
    const templatePackage = await manager
      .getRepository(TemplatePackageEntity)
      .findOne({ where: { packageId: reference.packageId } });
    if (!templatePackage)
      throw new NotFoundException('Frontend-пакет не зарегистрирован');
    const version = await manager
      .getRepository(TemplatePackageVersionEntity)
      .findOne({
        where: {
          templatePackageId: templatePackage.id,
          packageVersion: reference.packageVersion,
        },
      });
    if (!version)
      throw new NotFoundException('Версия frontend-пакета не зарегистрирована');
    const site = await manager.getRepository(SiteEntity).findOne({
      where: { slug: siteSlug },
      ...(lockSite ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!site) throw new NotFoundException('Сайт не найден');
    const assignments = await manager
      .getRepository(SiteContentTemplateEntity)
      .find({ where: { siteId: site.id, isActive: true } });
    const reasons = this.compatibilityReasons(
      site,
      templatePackage,
      version,
      assignments,
    );
    return {
      site,
      templatePackage,
      version,
      siteId: site.id,
      workspaceId: site.workspaceId,
      packageId: templatePackage.packageId,
      packageVersion: version.packageVersion,
      versionId: version.id,
      releaseDigest: version.releaseDigest,
      status: reasons.length ? 'mismatch' : 'ready',
      reasons,
    };
  }
}

type CompatibilityEvaluation = {
  site: SiteEntity;
  templatePackage: TemplatePackageEntity;
  version: TemplatePackageVersionEntity;
  siteId: string;
  workspaceId: string;
  packageId: string;
  packageVersion: string;
  versionId: string;
  releaseDigest: string;
  status: TemplatePackageCompatibilityStatus;
  reasons: TemplatePackageAuditReason[];
};

type RegistrationResult = {
  templatePackage: TemplatePackageEntity;
  version: TemplatePackageVersionEntity;
  created: boolean;
};
