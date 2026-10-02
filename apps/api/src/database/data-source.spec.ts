import { createDataSourceOptions } from './data-source';
import { databaseEntities } from './entities';
import { RemainingMetadataRevisionTypes1790210000000 } from './migrations/1790210000000-RemainingMetadataRevisionTypes';

describe('database migrations', () => {
  it('preserves both branch ledgers without renaming applied migrations', () => {
    const migrations = createDataSourceOptions().migrations as Array<
      new () => { name?: string }
    >;
    const names = migrations.map(
      (Migration) => new Migration().name || Migration.name,
    );
    expect(names).toHaveLength(49);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(
      expect.arrayContaining([
        'ContentCenterPreparation1790020800000',
        'PreparationCheckpoints1791436800000',
        'SiteScopedRoles1790017200000',
        'RemainingMetadataRevisionTypes1790210000000',
        'AdminPasswordEmailConfirmation1791613200000',
        'RemoveCmsCodeEditing1791703200000',
      ]),
    );
    // These independent migrations were already applied in separate environments.
    // TypeORM identifies applied migrations by full name, not timestamp alone.
    expect(names.filter((name) => name.endsWith('1790107200000'))).toEqual([
      'ContentCenterSourceFiles1790107200000',
      'ProtectCmsRevisionHistory1790107200000',
    ]);
  });

  it('registers the migration for the remaining revisioned metadata resources', () => {
    const options = createDataSourceOptions();

    expect(options.migrations).toContain(
      RemainingMetadataRevisionTypes1790210000000,
    );
  });

  it('registers site-level access assignments as the canonical permission source', () => {
    const options = createDataSourceOptions();
    const migrationNames = (
      options.migrations as Array<new () => { name?: string }>
    ).map((Migration) => new Migration().name || Migration.name);
    const entityNames = databaseEntities.map((Entity) => Entity.name);

    expect(migrationNames).toContain('SiteAccessAssignments1791523200000');
    expect(entityNames).toContain('SiteAccessEntity');
  });

  it('registers administrator password reset storage and session versions', () => {
    const options = createDataSourceOptions();
    const migrationNames = (
      options.migrations as Array<new () => { name?: string }>
    ).map((Migration) => new Migration().name || Migration.name);
    const entityNames = databaseEntities.map((Entity) => Entity.name);

    expect(migrationNames).toContain(
      'AdminPasswordEmailConfirmation1791613200000',
    );
    expect(entityNames).toContain('AdminPasswordResetEntity');
  });
});
