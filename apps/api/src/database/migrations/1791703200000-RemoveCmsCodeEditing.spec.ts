import { createDataSourceOptions } from '../data-source';
import { RemoveCmsCodeEditing1791703200000 } from './1791703200000-RemoveCmsCodeEditing';

describe('RemoveCmsCodeEditing migration', () => {
  it('is registered in the application data source', () => {
    expect(createDataSourceOptions().migrations).toContain(
      RemoveCmsCodeEditing1791703200000,
    );
  });

  it('drops only the obsolete site access flag on upgrade', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RemoveCmsCodeEditing1791703200000().up({ query } as never);

    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain(
      'ALTER TABLE "site_accesses" DROP COLUMN "can_edit_code"',
    );
    expect(sql).not.toMatch(/DROP TABLE|cms_revision|content/i);
  });

  it('restores a disabled flag on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RemoveCmsCodeEditing1791703200000().down({ query } as never);

    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain('ADD "can_edit_code" boolean NOT NULL DEFAULT false');
  });
});
