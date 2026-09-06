import type { MigrationInterface, QueryRunner } from 'typeorm';

const draftSections = [
  ['general', 'Общие положения'],
  ['operator', 'Информация об операторе'],
  ['data_categories', 'Какие данные собираются'],
  ['purposes', 'Цели обработки данных'],
  ['processing', 'Порядок обработки данных'],
  ['third_parties', 'Передача данных третьим лицам'],
  ['services', 'Используемые сервисы'],
  ['cookies', 'Файлы cookie'],
  ['rights', 'Права пользователя'],
  ['final', 'Заключительные положения'],
].map(([key, title]) => ({
  key,
  title,
  body: 'Текст раздела будет добавлен после юридического утверждения.',
}));

const draftRules = [
  { sectionKey: 'data_categories', when: { setting: 'dataCategories' } },
  { sectionKey: 'purposes', when: { setting: 'purposes' } },
  { sectionKey: 'third_parties', when: { boolean: 'thirdPartyTransfer' } },
  { sectionKey: 'services', when: { setting: 'services' } },
  { sectionKey: 'cookies', when: { boolean: 'cookies' } },
];

export class AddPrivacyPolicyModel1788811200000 implements MigrationInterface {
  name = 'AddPrivacyPolicyModel1788811200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "privacy_legal_models" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" character varying(80) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "sections" jsonb NOT NULL,
        "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_privacy_legal_models" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_privacy_legal_models_version" UNIQUE ("version"),
        CONSTRAINT "CHK_privacy_legal_models_status" CHECK ("status" IN ('draft', 'approved'))
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "privacy_policy_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "site_id" uuid NOT NULL,
        "page_id" uuid NOT NULL,
        "legal_model_id" uuid NOT NULL,
        "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "display_template_key" character varying(80) NOT NULL DEFAULT 'system-policy',
        "display_template_version" character varying(40) NOT NULL DEFAULT '1',
        "automatic_snapshot" text,
        "manual_snapshot" text,
        "published_snapshot" text,
        "mode" character varying(20) NOT NULL DEFAULT 'automatic',
        "input_fingerprint" character varying(64),
        "legacy_content_preserved" boolean NOT NULL DEFAULT false,
        "generated_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_privacy_policy_states" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_privacy_policy_states_site" UNIQUE ("site_id"),
        CONSTRAINT "UQ_privacy_policy_states_page" UNIQUE ("page_id"),
        CONSTRAINT "CHK_privacy_policy_states_mode" CHECK ("mode" IN ('automatic', 'manual')),
        CONSTRAINT "FK_privacy_policy_site" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_privacy_policy_page" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_privacy_policy_model" FOREIGN KEY ("legal_model_id") REFERENCES "privacy_legal_models"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `INSERT INTO "privacy_legal_models" ("version", "status", "sections", "rules") VALUES ($1, 'draft', $2::jsonb, $3::jsonb)`,
      [
        '2026-09-draft-1',
        JSON.stringify(draftSections),
        JSON.stringify(draftRules),
      ],
    );
    await queryRunner.query(
      `INSERT INTO "privacy_policy_states" (
        "site_id", "page_id", "legal_model_id", "display_template_key",
        "display_template_version", "legacy_content_preserved"
      )
      SELECT p."site_id", p."id", m."id", 'system-policy', '1',
        (p."status" = 'published' OR p."blocks" <> '[]'::jsonb)
      FROM "pages" p
      CROSS JOIN "privacy_legal_models" m
      WHERE p."slug" = 'privacy-policy' AND m."version" = '2026-09-draft-1'
      ON CONFLICT ("site_id") DO NOTHING`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "privacy_policy_states"`);
    await queryRunner.query(`DROP TABLE "privacy_legal_models"`);
  }
}
