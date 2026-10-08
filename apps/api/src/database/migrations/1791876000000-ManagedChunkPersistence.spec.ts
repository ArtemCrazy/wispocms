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

describe('ManagedChunkPersistence migration', () => {
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

  it('exposes the composite unique metadata needed by tenant-safe foreign keys', () => {
    const uniques = getMetadataArgsStorage().uniques;
    const hasUnique = (target: typeof PageEntity, expected: string[]) =>
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
    ).toBe(true);
    expect(hasUnique(CmsRevisionEntity, ['resourceId', 'id'])).toBe(true);
  });

  it('creates the additive schema and immutable history without backfill', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new ManagedChunkPersistence1791876000000().up({ query } as never);

    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain('CHECK ("manifest_version" IN (1, 2))');
    expect(sql).toContain("'chunk_instance'");
    expect(sql).toContain("'chunk_layout'");
    for (const tableName of tableNames) {
      expect(sql).toContain('CREATE TABLE "' + tableName + '"');
    }
    expect(sql).toContain(
      'CREATE FUNCTION "reject_managed_chunk_history_mutation"',
    );
    for (const tableName of [
      'managed_chunk_contracts',
      'managed_chunk_instance_revisions',
      'managed_chunk_placements',
      'managed_chunk_migration_provenance',
    ]) {
      expect(sql).toContain('BEFORE UPDATE OR DELETE ON "' + tableName + '"');
    }
    expect(sql).toContain('verify_managed_chunk_revision_resource');
    expect(sql).not.toMatch(/INSERT\s+INTO/i);
  });

  it('guards every new dependency before rollback drops anything', async () => {
    const query = jest.fn().mockResolvedValue(undefined);

    await new ManagedChunkPersistence1791876000000().down({ query } as never);

    const statements = query.mock.calls.map(([value]) => String(value));
    const sql = statements.join('\n');
    expect(statements[0]).toMatch(/^\s*DO \$\$/);
    expect(sql.indexOf('DO $$')).toBeLessThan(sql.search(/DROP\s/i));
    for (const tableName of tableNames) {
      expect(statements[0]).toContain('FROM "' + tableName + '"');
    }
    expect(statements[0]).toContain("'chunk_instance'");
    expect(statements[0]).toContain("'chunk_layout'");
    expect(statements[0]).toContain('"manifest_version" = 2');
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
  });
});
