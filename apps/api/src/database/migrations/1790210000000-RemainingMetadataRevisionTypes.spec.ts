import { RemainingMetadataRevisionTypes1790210000000 } from './1790210000000-RemainingMetadataRevisionTypes';

describe('RemainingMetadataRevisionTypes migration', () => {
  it('adds code/list/media revision types and decorative media state', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new RemainingMetadataRevisionTypes1790210000000().up({
      query,
    } as never);
    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).toContain("'site_layout_bindings'");
    expect(sql).toContain("'site_article_list'");
    expect(sql).toContain("'media_alt'");
    expect(sql).toContain('is_decorative');
  });
});
