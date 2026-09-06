import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandPrivacyPolicyLifecycle1788984000000 implements MigrationInterface {
  name = 'ExpandPrivacyPolicyLifecycle1788984000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "privacy_legal_models"
        ADD COLUMN "approved_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "approved_by_user_id" uuid,
        ADD COLUMN "change_summary" text,
        ADD COLUMN "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD CONSTRAINT "FK_privacy_legal_model_approved_by"
          FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "privacy_policy_states"
        ADD COLUMN "display_template_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN "published_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "published_legal_model_version" character varying(80),
        ADD COLUMN "published_display_template_key" character varying(80),
        ADD COLUMN "published_display_template_version" character varying(40),
        ADD COLUMN "published_display_template_config" jsonb,
        ADD COLUMN "deferred_legal_model_id" uuid,
        ADD COLUMN "model_review_source_version" character varying(80),
        ADD COLUMN "model_review_comparison" jsonb,
        ADD CONSTRAINT "FK_privacy_policy_deferred_legal_model"
          FOREIGN KEY ("deferred_legal_model_id") REFERENCES "privacy_legal_models"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      UPDATE "privacy_legal_models"
      SET "approved_at" = "created_at"
      WHERE "status" = 'approved' AND "approved_at" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "privacy_legal_models"
      SET
        "sections" = "sections" || jsonb_build_array(jsonb_build_object(
          'key', 'collection_methods',
          'title', 'Способы сбора данных',
          'body', 'Текст раздела будет добавлен после юридического утверждения.'
        )),
        "rules" = "rules" || jsonb_build_array(jsonb_build_object(
          'sectionKey', 'collection_methods',
          'when', jsonb_build_object('setting', 'collectionMethods')
        )),
        "updated_at" = now()
      WHERE "status" = 'draft'
        AND NOT ("sections" @> '[{"key":"collection_methods"}]'::jsonb)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "privacy_policy_states"
        DROP CONSTRAINT "FK_privacy_policy_deferred_legal_model",
        DROP COLUMN "model_review_comparison",
        DROP COLUMN "model_review_source_version",
        DROP COLUMN "deferred_legal_model_id",
        DROP COLUMN "published_display_template_config",
        DROP COLUMN "published_display_template_version",
        DROP COLUMN "published_display_template_key",
        DROP COLUMN "published_legal_model_version",
        DROP COLUMN "published_at",
        DROP COLUMN "display_template_config"
    `);
    await queryRunner.query(`
      ALTER TABLE "privacy_legal_models"
        DROP CONSTRAINT "FK_privacy_legal_model_approved_by",
        DROP COLUMN "updated_at",
        DROP COLUMN "change_summary",
        DROP COLUMN "approved_by_user_id",
        DROP COLUMN "approved_at"
    `);
  }
}
