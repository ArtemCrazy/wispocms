import type { QueryRunner } from 'typeorm';
import { ExpandPrivacyPolicyLifecycle1788984000000 } from './1788984000000-ExpandPrivacyPolicyLifecycle';

describe('ExpandPrivacyPolicyLifecycle1788984000000', () => {
  it('adds lifecycle metadata, deferred-model integrity and collection methods', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ExpandPrivacyPolicyLifecycle1788984000000().up({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('approved_by_user_id');
    expect(sql).toContain('FK_privacy_policy_deferred_legal_model');
    expect(sql).toContain('collection_methods');
    expect(sql).toContain('collectionMethods');
    expect(sql).toContain('SET "approved_at" = "created_at"');
  });

  it('drops the added constraints before their columns', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new ExpandPrivacyPolicyLifecycle1788984000000().down({
      query,
    } as unknown as QueryRunner);
    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain(
      'DROP CONSTRAINT "FK_privacy_policy_deferred_legal_model"',
    );
    expect(sql).toContain(
      'DROP CONSTRAINT "FK_privacy_legal_model_approved_by"',
    );
  });
});
