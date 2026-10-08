import { getMetadataArgsStorage } from 'typeorm';
import { createDataSourceOptions } from '../data-source';
import {
  CmsRevisionEntity,
  CmsRevisionResourceEntity,
  databaseEntities,
  ManagedChunkContractEntity,
  ManagedChunkInstanceEntity,
  ManagedChunkInstanceRevisionEntity,
  ManagedChunkLayoutEntity,
  ManagedChunkMigrationProvenanceEntity,
  ManagedChunkPlacementEntity,
  PageEntity,
} from '../entities';
import { ManagedChunkPersistence1791876000000 } from './1791876000000-ManagedChunkPersistence';

const tableNames = [
  'managed_chunk_contracts',
  'managed_chunk_instances',
  'managed_chunk_instance_revisions',
  'managed_chunk_layouts',
  'managed_chunk_placements',
  'managed_chunk_migration_provenance',
] as const;

const previousResourceTypes = [
  'article',
  'category',
  'author',
  'page',
  'banner',
  'site_variable',
  'template',
  'chunk',
  'site_globals',
  'site_header',
  'site_footer',
  'site_variables',
  'site_seo',
  'site_search',
  'site_not_found',
  'site_privacy',
  'site_layout_bindings',
  'site_article_list',
  'media_alt',
] as const;

const normalizeSql = (value: unknown) =>
  String(value)
    .replace(/\s+/g, ' ')
    .replace(/\s*([(),])\s*/g, '$1')
    .trim();

const statementContaining = (statements: string[], fragment: string) => {
  const normalizedFragment = normalizeSql(fragment);
  const statement = statements.find((candidate) =>
    candidate.includes(normalizedFragment),
  );
  expect(statement).toBeDefined();
  return statement as string;
};

const expectFragment = (statement: string, fragment: string) => {
  expect(statement).toContain(normalizeSql(fragment));
};

const quoted = (columns: string[]) =>
  columns.map((column) => '"' + column + '"').join(', ');

const expectForeignKey = (
  tableStatement: string,
  constraint: string,
  columns: string[],
  referencedTable: string,
  referencedColumns: string[],
  onDelete: 'RESTRICT' | 'SET NULL',
) => {
  expectFragment(
    tableStatement,
    'CONSTRAINT "' +
      constraint +
      '" FOREIGN KEY (' +
      quoted(columns) +
      ') REFERENCES "' +
      referencedTable +
      '"(' +
      quoted(referencedColumns) +
      ') ON DELETE ' +
      onDelete,
  );
};

const expectUnique = (
  tableStatement: string,
  constraint: string,
  columns: string[],
) => {
  expectFragment(
    tableStatement,
    'CONSTRAINT "' + constraint + '" UNIQUE (' + quoted(columns) + ')',
  );
};

const quotedCheckValues = (statement: string, column: string) => {
  const match = statement.match(
    new RegExp('CHECK\\("' + column + '" IN\\((.*?)\\)\\)'),
  );
  expect(match).not.toBeNull();
  return [...(match?.[1].matchAll(/'([^']+)'/g) ?? [])].map(
    ([, value]) => value,
  );
};

const expectColumn = (
  tableStatement: string,
  column: string,
  definition: string,
) => {
  const match = tableStatement.match(new RegExp('"' + column + '" ([^,]+),'));
  expect(match?.[1]).toBe(normalizeSql(definition));
};

describe('ManagedChunkPersistence migration', () => {
  let upStatements: string[];
  let downStatements: string[];

  beforeAll(async () => {
    const upQuery = jest.fn().mockResolvedValue(undefined);
    const downQuery = jest.fn().mockResolvedValue(undefined);
    const migration = new ManagedChunkPersistence1791876000000();

    await migration.up({ query: upQuery } as never);
    await migration.down({ query: downQuery } as never);

    upStatements = upQuery.mock.calls.map(([value]) => normalizeSql(value));
    downStatements = downQuery.mock.calls.map(([value]) => normalizeSql(value));
  });

  it('is the last uniquely named migration and registers all six entities', () => {
    const migrations = createDataSourceOptions().migrations as Array<
      new () => { name?: string }
    >;
    const names = migrations.map(
      (Migration) => new Migration().name || Migration.name,
    );

    expect(migrations.at(-1)).toBe(ManagedChunkPersistence1791876000000);
    expect(new Set(names).size).toBe(names.length);
    expect(databaseEntities).toEqual(
      expect.arrayContaining([
        ManagedChunkContractEntity,
        ManagedChunkInstanceEntity,
        ManagedChunkInstanceRevisionEntity,
        ManagedChunkLayoutEntity,
        ManagedChunkPlacementEntity,
        ManagedChunkMigrationProvenanceEntity,
      ]),
    );
  });

  it('exposes only the composite unique metadata consumed by tenant-safe foreign keys', () => {
    const uniques = getMetadataArgsStorage().uniques;
    const indices = getMetadataArgsStorage().indices;
    const hasUnique = (
      target:
        | typeof PageEntity
        | typeof CmsRevisionResourceEntity
        | typeof CmsRevisionEntity,
      expected: string[],
    ) =>
      uniques.some(({ target: candidate, columns }) => {
        const resolved = typeof columns === 'function' ? columns({}) : columns;
        return (
          candidate === target &&
          Array.isArray(resolved) &&
          resolved.join(',') === expected.join(',')
        );
      });

    expect(hasUnique(PageEntity, ['id', 'siteId'])).toBe(true);
    expect(
      hasUnique(CmsRevisionResourceEntity, [
        'id',
        'siteId',
        'resourceType',
        'entityId',
      ]),
    ).toBe(false);
    expect(hasUnique(CmsRevisionEntity, ['resourceId', 'id'])).toBe(true);
    expect(
      indices.some(
        ({ target, columns }) =>
          target === ManagedChunkContractEntity &&
          Array.isArray(columns) &&
          columns.join(',') === 'templatePackageId',
      ),
    ).toBe(false);
  });

  it('preserves every resource type and creates all value checks without backfill', () => {
    const sql = upStatements.join(' ');
    const resourceCheck = statementContaining(
      upStatements,
      'ALTER TABLE "cms_revision_resources"',
    );
    const contract = statementContaining(
      upStatements,
      'CREATE TABLE "managed_chunk_contracts"',
    );
    const layout = statementContaining(
      upStatements,
      'CREATE TABLE "managed_chunk_layouts"',
    );
    const placement = statementContaining(
      upStatements,
      'CREATE TABLE "managed_chunk_placements"',
    );
    const provenance = statementContaining(
      upStatements,
      'CREATE TABLE "managed_chunk_migration_provenance"',
    );

    expectFragment(
      statementContaining(
        upStatements,
        'ALTER TABLE "template_package_versions"',
      ),
      'CHECK ("manifest_version" IN (1, 2))',
    );
    expect(quotedCheckValues(resourceCheck, 'resource_type')).toEqual([
      ...previousResourceTypes,
      'chunk_instance',
      'chunk_layout',
    ]);
    for (const tableName of tableNames) {
      statementContaining(upStatements, 'CREATE TABLE "' + tableName + '"');
    }
    expectFragment(
      contract,
      `CONSTRAINT "CHK_managed_chunk_contracts_field_contract_object"
        CHECK (jsonb_typeof("field_contract") = 'object')`,
    );
    expectFragment(
      contract,
      `CONSTRAINT "CHK_managed_chunk_contracts_data_schema_object"
        CHECK (jsonb_typeof("data_schema") = 'object')`,
    );
    expectFragment(
      contract,
      `CONSTRAINT "CHK_managed_chunk_contracts_digest"
        CHECK ("contract_digest" ~ '^sha256:[0-9a-f]{64}$')`,
    );
    expectFragment(
      layout,
      `CONSTRAINT "CHK_managed_chunk_layouts_scope" CHECK (
        ("scope_kind" = 'page' AND "page_id" IS NOT NULL AND "surface_key" IS NULL)
        OR
        ("scope_kind" = 'site_surface' AND "page_id" IS NULL AND "surface_key" IS NOT NULL)
      )`,
    );
    expectFragment(
      placement,
      `CONSTRAINT "CHK_managed_chunk_placements_position"
        CHECK ("position" >= 0)`,
    );
    expectFragment(
      provenance,
      `CONSTRAINT "CHK_managed_chunk_migration_provenance_source_type"
        CHECK ("source_type" IN ('banner', 'page_banner_assignment'))`,
    );
    expectFragment(
      provenance,
      `CONSTRAINT "CHK_managed_chunk_migration_provenance_target" CHECK (
        (CASE WHEN "instance_id" IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "layout_id" IS NULL THEN 0 ELSE 1 END) +
        (CASE WHEN "placement_id" IS NULL THEN 0 ELSE 1 END) = 1
      )`,
    );
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });

  it('keeps every managed table column type, nullability, length, and default exact', () => {
    const table = (name: string) =>
      statementContaining(upStatements, 'CREATE TABLE "' + name + '"');
    const definitions: Record<string, Record<string, string>> = {
      managed_chunk_contracts: {
        id: 'uuid NOT NULL DEFAULT uuid_generate_v4()',
        template_package_id: 'uuid NOT NULL',
        first_seen_template_package_version_id: 'uuid NOT NULL',
        definition_key: 'varchar(80) NOT NULL',
        schema_version: 'varchar(40) NOT NULL',
        contract_digest: 'varchar(80) NOT NULL',
        field_contract: 'jsonb NOT NULL',
        data_schema: 'jsonb NOT NULL',
        created_at: 'timestamptz NOT NULL DEFAULT now()',
      },
      managed_chunk_instances: {
        id: 'uuid NOT NULL DEFAULT uuid_generate_v4()',
        site_id: 'uuid NOT NULL',
        revision_resource_id: 'uuid NOT NULL',
        display_name: 'varchar(160) NOT NULL',
        is_archived: 'boolean NOT NULL DEFAULT false',
        created_by_user_id: 'uuid',
        created_at: 'timestamptz NOT NULL DEFAULT now()',
        updated_at: 'timestamptz NOT NULL DEFAULT now()',
      },
      managed_chunk_instance_revisions: {
        revision_id: 'uuid NOT NULL',
        revision_resource_id: 'uuid NOT NULL',
        site_id: 'uuid NOT NULL',
        instance_id: 'uuid NOT NULL',
        contract_id: 'uuid NOT NULL',
      },
      managed_chunk_layouts: {
        id: 'uuid NOT NULL DEFAULT uuid_generate_v4()',
        site_id: 'uuid NOT NULL',
        revision_resource_id: 'uuid NOT NULL',
        scope_kind: 'varchar(24) NOT NULL',
        page_id: 'uuid',
        surface_key: 'varchar(80)',
        created_at: 'timestamptz NOT NULL DEFAULT now()',
      },
      managed_chunk_placements: {
        id: 'uuid NOT NULL DEFAULT uuid_generate_v4()',
        site_id: 'uuid NOT NULL',
        layout_id: 'uuid NOT NULL',
        layout_revision_resource_id: 'uuid NOT NULL',
        layout_revision_id: 'uuid NOT NULL',
        instance_id: 'uuid NOT NULL',
        slot_key: 'varchar(80) NOT NULL',
        position: 'integer NOT NULL',
      },
      managed_chunk_migration_provenance: {
        id: 'uuid NOT NULL DEFAULT uuid_generate_v4()',
        site_id: 'uuid NOT NULL',
        migration_version: 'varchar(80) NOT NULL',
        source_type: 'varchar(40) NOT NULL',
        source_id: 'uuid NOT NULL',
        source_checksum: 'varchar(128) NOT NULL',
        instance_id: 'uuid',
        layout_id: 'uuid',
        placement_id: 'uuid',
        created_at: 'timestamptz NOT NULL DEFAULT now()',
      },
    };

    for (const [tableName, columns] of Object.entries(definitions)) {
      const tableStatement = table(tableName);
      const columnsOnly = tableStatement.slice(
        tableStatement.indexOf('('),
        tableStatement.indexOf(',CONSTRAINT'),
      );
      const actualColumnNames = [
        ...columnsOnly.matchAll(/(?:\(|,)"([^"]+)" /g),
      ].map(([, column]) => column);
      expect(actualColumnNames).toEqual(Object.keys(columns));
      for (const [column, definition] of Object.entries(columns)) {
        expectColumn(tableStatement, column, definition);
      }
    }
  });

  it('wires every tenant-safe foreign key with the required delete action', () => {
    const table = (name: string) =>
      statementContaining(upStatements, 'CREATE TABLE "' + name + '"');
    const contract = table('managed_chunk_contracts');
    const instance = table('managed_chunk_instances');
    const instanceRevision = table('managed_chunk_instance_revisions');
    const layout = table('managed_chunk_layouts');
    const placement = table('managed_chunk_placements');
    const provenance = table('managed_chunk_migration_provenance');

    expectForeignKey(
      contract,
      'FK_managed_chunk_contracts_package',
      ['template_package_id'],
      'template_packages',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      contract,
      'FK_managed_chunk_contracts_first_seen_version',
      ['first_seen_template_package_version_id', 'template_package_id'],
      'template_package_versions',
      ['id', 'template_package_id'],
      'RESTRICT',
    );
    expectForeignKey(
      instance,
      'FK_managed_chunk_instances_site',
      ['site_id'],
      'sites',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      instance,
      'FK_managed_chunk_instances_revision_resource',
      ['revision_resource_id'],
      'cms_revision_resources',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      instance,
      'FK_managed_chunk_instances_actor',
      ['created_by_user_id'],
      'users',
      ['id'],
      'SET NULL',
    );
    expectForeignKey(
      instanceRevision,
      'FK_managed_chunk_instance_revisions_revision',
      ['revision_resource_id', 'revision_id'],
      'cms_revisions',
      ['resource_id', 'id'],
      'RESTRICT',
    );
    expectForeignKey(
      instanceRevision,
      'FK_managed_chunk_instance_revisions_instance',
      ['site_id', 'instance_id', 'revision_resource_id'],
      'managed_chunk_instances',
      ['site_id', 'id', 'revision_resource_id'],
      'RESTRICT',
    );
    expectForeignKey(
      instanceRevision,
      'FK_managed_chunk_instance_revisions_contract',
      ['contract_id'],
      'managed_chunk_contracts',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      layout,
      'FK_managed_chunk_layouts_site',
      ['site_id'],
      'sites',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      layout,
      'FK_managed_chunk_layouts_revision_resource',
      ['revision_resource_id'],
      'cms_revision_resources',
      ['id'],
      'RESTRICT',
    );
    expectForeignKey(
      layout,
      'FK_managed_chunk_layouts_page',
      ['page_id', 'site_id'],
      'pages',
      ['id', 'site_id'],
      'RESTRICT',
    );
    expectForeignKey(
      placement,
      'FK_managed_chunk_placements_layout',
      ['site_id', 'layout_id', 'layout_revision_resource_id'],
      'managed_chunk_layouts',
      ['site_id', 'id', 'revision_resource_id'],
      'RESTRICT',
    );
    expectForeignKey(
      placement,
      'FK_managed_chunk_placements_revision',
      ['layout_revision_resource_id', 'layout_revision_id'],
      'cms_revisions',
      ['resource_id', 'id'],
      'RESTRICT',
    );
    expectForeignKey(
      placement,
      'FK_managed_chunk_placements_instance',
      ['site_id', 'instance_id'],
      'managed_chunk_instances',
      ['site_id', 'id'],
      'RESTRICT',
    );
    expectForeignKey(
      provenance,
      'FK_managed_chunk_migration_provenance_site',
      ['site_id'],
      'sites',
      ['id'],
      'RESTRICT',
    );
    for (const [target, targetTable] of [
      ['instance', 'managed_chunk_instances'],
      ['layout', 'managed_chunk_layouts'],
      ['placement', 'managed_chunk_placements'],
    ] as const) {
      expectForeignKey(
        provenance,
        'FK_managed_chunk_migration_provenance_' + target,
        ['site_id', target + '_id'],
        targetTable,
        ['site_id', 'id'],
        'RESTRICT',
      );
    }
  });

  it('creates every required composite unique and partial target index', () => {
    const table = (name: string) =>
      statementContaining(upStatements, 'CREATE TABLE "' + name + '"');
    const contract = table('managed_chunk_contracts');
    const instance = table('managed_chunk_instances');
    const layout = table('managed_chunk_layouts');
    const placement = table('managed_chunk_placements');
    const provenance = table('managed_chunk_migration_provenance');

    expectFragment(
      statementContaining(upStatements, 'ALTER TABLE "pages"'),
      'ADD CONSTRAINT "UQ_pages_id_site_id" UNIQUE ("id", "site_id")',
    );
    expect(upStatements.join(' ')).not.toContain(
      'UQ_cms_revision_resources_exact_identity',
    );
    expect(upStatements.join(' ')).not.toContain(
      'IDX_managed_chunk_contracts_package',
    );
    expectUnique(contract, 'UQ_managed_chunk_contracts_identity', [
      'template_package_id',
      'definition_key',
      'schema_version',
    ]);
    expectUnique(instance, 'UQ_managed_chunk_instances_revision_resource', [
      'revision_resource_id',
    ]);
    expectUnique(instance, 'UQ_managed_chunk_instances_site_id', [
      'site_id',
      'id',
    ]);
    expectUnique(instance, 'UQ_managed_chunk_instances_exact_identity', [
      'site_id',
      'id',
      'revision_resource_id',
    ]);
    expectUnique(layout, 'UQ_managed_chunk_layouts_revision_resource', [
      'revision_resource_id',
    ]);
    expectUnique(layout, 'UQ_managed_chunk_layouts_site_id', ['site_id', 'id']);
    expectUnique(layout, 'UQ_managed_chunk_layouts_exact_identity', [
      'site_id',
      'id',
      'revision_resource_id',
    ]);
    expectUnique(placement, 'UQ_managed_chunk_placements_site_id', [
      'site_id',
      'id',
    ]);
    expectUnique(placement, 'UQ_managed_chunk_placements_position', [
      'layout_revision_id',
      'slot_key',
      'position',
    ]);
    expectUnique(provenance, 'UQ_managed_chunk_migration_provenance_source', [
      'migration_version',
      'source_type',
      'source_id',
    ]);
    expect(
      statementContaining(
        upStatements,
        'CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_page_target"',
      ),
    ).toBe(
      normalizeSql(`
        CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_page_target"
        ON "managed_chunk_layouts" ("site_id", "page_id")
        WHERE "scope_kind" = 'page'
      `),
    );
    expect(
      statementContaining(
        upStatements,
        'CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_surface_target"',
      ),
    ).toBe(
      normalizeSql(`
        CREATE UNIQUE INDEX "UQ_managed_chunk_layouts_surface_target"
        ON "managed_chunk_layouts" ("site_id", "surface_key")
        WHERE "scope_kind" = 'site_surface'
      `),
    );
  });

  it('makes history immutable and enforces deferred exact resource identity', () => {
    const verifier = statementContaining(
      upStatements,
      'CREATE FUNCTION "verify_managed_chunk_revision_resource"',
    );
    const reverseGuard = statementContaining(
      upStatements,
      'CREATE FUNCTION "protect_managed_chunk_revision_resource_identity"',
    );

    for (const fragment of [
      `WHEN 'managed_chunk_instances' THEN 'chunk_instance'`,
      `WHEN 'managed_chunk_layouts' THEN 'chunk_layout'`,
      `resource."id" = NEW."revision_resource_id"`,
      `resource."site_id" = NEW."site_id"`,
      `resource."resource_type" = expected_resource_type`,
      `resource."entity_id" = NEW."id"`,
    ]) {
      expectFragment(verifier, fragment);
    }
    for (const tableName of [
      'managed_chunk_instances',
      'managed_chunk_layouts',
    ]) {
      expect(
        statementContaining(
          upStatements,
          'CREATE CONSTRAINT TRIGGER "TRG_' + tableName + '_resource_identity"',
        ),
      ).toBe(
        normalizeSql(
          'CREATE CONSTRAINT TRIGGER "TRG_' +
            tableName +
            '_resource_identity" AFTER INSERT OR UPDATE ON "' +
            tableName +
            '" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW ' +
            'EXECUTE FUNCTION "verify_managed_chunk_revision_resource"()',
        ),
      );
    }
    for (const fragment of [
      `FROM "managed_chunk_instances" instance`,
      `instance."revision_resource_id" = NEW."id"`,
      `NEW."site_id" <> instance."site_id"`,
      `NEW."resource_type" <> 'chunk_instance'`,
      `NEW."entity_id" <> instance."id"`,
      `FROM "managed_chunk_layouts" layout`,
      `layout."revision_resource_id" = NEW."id"`,
      `NEW."site_id" <> layout."site_id"`,
      `NEW."resource_type" <> 'chunk_layout'`,
      `NEW."entity_id" <> layout."id"`,
    ]) {
      expectFragment(reverseGuard, fragment);
    }
    expect(
      statementContaining(
        upStatements,
        'CREATE CONSTRAINT TRIGGER "TRG_cms_revision_resources_managed_chunk_identity"',
      ),
    ).toBe(
      normalizeSql(`
        CREATE CONSTRAINT TRIGGER "TRG_cms_revision_resources_managed_chunk_identity"
        AFTER UPDATE OF "site_id", "resource_type", "entity_id"
        ON "cms_revision_resources"
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW
        EXECUTE FUNCTION "protect_managed_chunk_revision_resource_identity"()
      `),
    );
    statementContaining(
      upStatements,
      'CREATE FUNCTION "reject_managed_chunk_history_mutation"',
    );
    for (const tableName of [
      'managed_chunk_contracts',
      'managed_chunk_instance_revisions',
      'managed_chunk_placements',
      'managed_chunk_migration_provenance',
    ]) {
      expect(
        statementContaining(
          upStatements,
          'CREATE TRIGGER "TRG_' + tableName + '_immutable"',
        ),
      ).toBe(
        normalizeSql(
          'CREATE TRIGGER "TRG_' +
            tableName +
            '_immutable" BEFORE UPDATE OR DELETE ON "' +
            tableName +
            '" FOR EACH ROW EXECUTE FUNCTION ' +
            '"reject_managed_chunk_history_mutation"()',
        ),
      );
    }
  });

  it('protects stable owner identities while allowing instance organization updates', () => {
    const protector = statementContaining(
      upStatements,
      'CREATE FUNCTION "protect_managed_chunk_owner_identity"',
    );

    for (const tableName of [
      'managed_chunk_instances',
      'managed_chunk_layouts',
    ]) {
      expect(
        statementContaining(
          upStatements,
          'CREATE TRIGGER "TRG_' + tableName + '_protect_identity"',
        ),
      ).toBe(
        normalizeSql(
          'CREATE TRIGGER "TRG_' +
            tableName +
            '_protect_identity" BEFORE UPDATE OR DELETE ON "' +
            tableName +
            '" FOR EACH ROW EXECUTE FUNCTION ' +
            '"protect_managed_chunk_owner_identity"()',
        ),
      );
    }
    expectFragment(protector, `IF TG_OP = 'DELETE' THEN`);
    expectFragment(
      protector,
      `
        IF TG_TABLE_NAME = 'managed_chunk_layouts'
          AND (
            NEW."id" IS DISTINCT FROM OLD."id"
            OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
            OR NEW."revision_resource_id" IS DISTINCT FROM OLD."revision_resource_id"
            OR NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"
            OR NEW."page_id" IS DISTINCT FROM OLD."page_id"
            OR NEW."surface_key" IS DISTINCT FROM OLD."surface_key"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
          )
        THEN
      `,
    );
    expectFragment(
      protector,
      `
        IF TG_TABLE_NAME = 'managed_chunk_instances'
          AND (
            NEW."id" IS DISTINCT FROM OLD."id"
            OR NEW."site_id" IS DISTINCT FROM OLD."site_id"
            OR NEW."revision_resource_id" IS DISTINCT FROM OLD."revision_resource_id"
            OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
            OR (
              NEW."created_by_user_id" IS DISTINCT FROM OLD."created_by_user_id"
              AND NEW."created_by_user_id" IS NOT NULL
            )
          )
        THEN
      `,
    );
    expectFragment(protector, 'RETURN NEW');
    expect(protector).not.toContain('NEW."display_name" IS DISTINCT');
    expect(protector).not.toContain('NEW."is_archived" IS DISTINCT');
    expect(protector).not.toContain('NEW."updated_at" IS DISTINCT');
    expect(protector).not.toContain('NEW IS DISTINCT FROM OLD');
    expect(protector).not.toContain("TG_OP = 'UPDATE'");
    expect(protector).not.toContain(
      normalizeSql(
        `IF TG_TABLE_NAME = 'managed_chunk_layouts' THEN RAISE EXCEPTION`,
      ),
    );
  });

  it('locks every guard dependency in the first rollback call before checking or dropping', () => {
    const firstCall = downStatements[0];
    const lockFragment = `
      LOCK TABLE
        "template_package_versions",
        "cms_revision_resources",
        "managed_chunk_contracts",
        "managed_chunk_instances",
        "managed_chunk_instance_revisions",
        "managed_chunk_layouts",
        "managed_chunk_placements",
        "managed_chunk_migration_provenance"
      IN SHARE ROW EXCLUSIVE MODE;
    `;

    expect(firstCall.startsWith(normalizeSql(lockFragment))).toBe(true);
    expect(firstCall.indexOf('LOCK TABLE')).toBeLessThan(
      firstCall.indexOf('DO $$'),
    );
    expect(firstCall.indexOf('DO $$')).toBeLessThan(
      firstCall.indexOf('IF EXISTS'),
    );
    expect(firstCall).not.toMatch(/\bDROP\b/);
  });

  it('guards rollback before drops, uses FK-safe order, and restores exact checks', () => {
    const guard = downStatements[0];
    const firstDropIndex = downStatements.findIndex((statement) =>
      /\bDROP\b/.test(statement),
    );
    const indexOf = (fragment: string) => {
      const index = downStatements.findIndex((statement) =>
        statement.includes(normalizeSql(fragment)),
      );
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };
    const expectBefore = (first: string, second: string) => {
      expect(indexOf(first)).toBeLessThan(indexOf(second));
    };

    expect(guard).toContain('DO $$');
    expect(firstDropIndex).toBeGreaterThan(0);
    for (const tableName of tableNames) {
      expectFragment(guard, 'EXISTS (SELECT 1 FROM "' + tableName + '")');
    }
    expectFragment(
      guard,
      `FROM "cms_revision_resources"
        WHERE "resource_type" IN ('chunk_instance', 'chunk_layout')`,
    );
    expectFragment(
      guard,
      `FROM "template_package_versions"
        WHERE "manifest_version" = 2`,
    );
    expectBefore(
      'DROP TABLE "managed_chunk_migration_provenance"',
      'DROP TABLE "managed_chunk_placements"',
    );
    expectBefore(
      'DROP TABLE "managed_chunk_placements"',
      'DROP TABLE "managed_chunk_layouts"',
    );
    expectBefore(
      'DROP TABLE "managed_chunk_placements"',
      'DROP TABLE "managed_chunk_instances"',
    );
    expectBefore(
      'DROP TABLE "managed_chunk_instance_revisions"',
      'DROP TABLE "managed_chunk_instances"',
    );
    expectBefore(
      'DROP TABLE "managed_chunk_instance_revisions"',
      'DROP TABLE "managed_chunk_contracts"',
    );
    expectBefore(
      'DROP TABLE "managed_chunk_layouts"',
      'DROP CONSTRAINT "UQ_pages_id_site_id"',
    );
    expectBefore(
      'DROP TRIGGER "TRG_managed_chunk_instances_resource_identity"',
      'DROP TABLE "managed_chunk_instances"',
    );
    expectBefore(
      'DROP TRIGGER "TRG_managed_chunk_layouts_resource_identity"',
      'DROP TABLE "managed_chunk_layouts"',
    );
    expectBefore(
      'DROP TRIGGER "TRG_managed_chunk_instances_protect_identity"',
      'DROP TABLE "managed_chunk_instances"',
    );
    expectBefore(
      'DROP TRIGGER "TRG_managed_chunk_layouts_protect_identity"',
      'DROP TABLE "managed_chunk_layouts"',
    );
    expectBefore(
      'DROP FUNCTION "protect_managed_chunk_owner_identity"()',
      'DROP TABLE "managed_chunk_instances"',
    );

    const resourceRestore = statementContaining(
      downStatements,
      'ADD CONSTRAINT "CHK_cms_revision_resources_type"',
    );
    expect(quotedCheckValues(resourceRestore, 'resource_type')).toEqual([
      ...previousResourceTypes,
    ]);
    expectFragment(
      statementContaining(
        downStatements,
        'ALTER TABLE "template_package_versions"',
      ),
      'CHECK ("manifest_version" = 1)',
    );
    expect(downStatements.join(' ')).not.toContain(
      'UQ_cms_revision_resources_exact_identity',
    );
    expect(downStatements.join(' ')).not.toContain(
      'IDX_managed_chunk_contracts_package',
    );
    expect(downStatements.join(' ')).not.toMatch(/DELETE\s+FROM/i);
  });
});
