import { createDataSourceOptions } from './data-source';
import { RemainingMetadataRevisionTypes1790210000000 } from './migrations/1790210000000-RemainingMetadataRevisionTypes';

describe('database migrations', () => {
  it('registers the migration for the remaining revisioned metadata resources', () => {
    const options = createDataSourceOptions();

    expect(options.migrations).toContain(
      RemainingMetadataRevisionTypes1790210000000,
    );
  });
});
