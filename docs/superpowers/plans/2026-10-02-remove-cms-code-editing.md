# Remove CMS Code Editing Implementation Plan

**Goal:** Remove code editing and `canEditCode` from Wispo CMS while preserving versioned content and owner-only selection of predefined React templates.

**Architecture:** React templates and components are source code in each site's Git repository. CMS stores content, component data, template assignments and revisions. Historical template/chunk revision rows remain untouched, but CMS exposes no route or screen that edits their code.

**Tech stack:** NestJS, TypeORM, PostgreSQL, Next.js, React, Jest, Node contract tests, Playwright.

## Tasks

- [x] Write failing API and web tests for the code-free access contract.
- [x] Remove `canEditCode` from DTOs, entities, services, session payloads and UI types.
- [x] Add migration `1791703200000-RemoveCmsCodeEditing.ts` that only drops `site_accesses.can_edit_code`; its `down()` restores `boolean NOT NULL DEFAULT false`.
- [x] Replace `VIEW_CODE`, `EDIT_CODE` and `PUBLISH_CODE` with owner/admin-only `MANAGE_STRUCTURE` for predefined template assignments.
- [x] Remove `/code-resources/*`, `CodeResourcesService` and the HTML code editor while preserving `/versioned/:resource` content endpoints.
- [x] Remove code checkboxes and badges from user creation, editing and team summaries; keep `requiresApproval` for content managers.
- [x] Rename visible `Шаблоны и чанки` labels to `Шаблоны`; keep template assignment limited to Wispo administrators and site owners.
- [x] Document the React/Git versus CMS/data boundary and banner schema-evolution workflow.
- [x] Run the affected API tests, architecture contract tests, lint, production builds and local browser checks for all three roles.
- [x] Apply the migration only to the local database. VDS, `main` and external databases remain untouched; commit was authorized separately after verification.

## Primary files

- API access: `apps/api/src/content/content.permissions.ts`, `apps/api/src/platform/platform.dto.ts`, `apps/api/src/platform/platform.service.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/database/entities.ts`.
- API code removal: `apps/api/src/content/site-resource-revisions.controller.ts`, `apps/api/src/content/content.module.ts`, `apps/api/src/content/code-resources.service.ts`.
- Structural revisions: `apps/api/src/content/cms-revisions.service.ts`, `apps/api/src/content/content-metadata-revisions.service.ts`, `apps/api/src/content/site-resource-revisions.service.ts`, `apps/api/src/content/content.service.ts`.
- Web access: `apps/web/src/app/site-access.ts`, `apps/web/src/app/team-access-view.tsx`, `apps/web/src/app/team-user-editor-modal.tsx`, `apps/web/src/app/team-access-summary.ts`.
- Web code removal: `apps/web/src/app/page.tsx`, `apps/web/src/app/media-templates-view.tsx`, `apps/web/src/app/code-resources-editor.tsx`, `apps/web/src/app/media-articles-view.tsx`, `apps/web/src/app/not-found-page-view.tsx`.

## Verification

Completed locally: the full API unit set has 731 passed, 76 skipped and no
failures; the focused alternative versioned/restore structural set has 65/65.
Also completed: 22 Content Center integration tests on the isolated test
database, 21 targeted web contract tests, 24 Playwright role/navigation
scenarios, lint of changed production files and both production builds. The
complete legacy web contract set is 158/160; its two unrelated stale expectations
are documented in `docs/change-log.md`. No external environment was used for
verification.
