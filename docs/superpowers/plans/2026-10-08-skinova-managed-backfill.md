# Skinova Managed Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Safely import the currently published Skinova banners and placements into registered `skinova-media@2` managed content without changing the live package pointer, legacy data, or current public output.

**Architecture:** A release-token-protected command builds a strict projection from legacy rows, validates the complete source and target state, then atomically creates managed instances, one published baseline revision per instance, layouts, placements, and immutable provenance. A retry is a no-op only when provenance, checksum, and the full target are exact; ambiguity, drift, partial state, and unknown mappings fail closed.

**Tech Stack:** NestJS, TypeORM, PostgreSQL, Jest, Node.js release CLI, JSON package manifests.

---

## Safety boundaries

- Work only in `codex/managed-chunks-sdk-v1` and its linked local worktree.
- Do not change site package pointers, current public runtime, legacy rows, or CMS UI.
- No schema migration: the existing managed persistence schema is sufficient.
- Import current published state only. History/drafts, shadow read, dual write, broad concurrency, UI/runtime smoke, and performance remain in `docs/managed-chunks-post-mvp-review.md`.
- Do not push, merge, deploy, or touch VDS/shared DB. Use a disposable PostgreSQL DB for one critical acceptance check.
- Keep implementation uncommitted until phase review, then offer one separate commit.

## Task 1: Correct Skinova v2 contract

**Files:**

- Modify: `apps/web/template-packages/skinova/manifest.v2.template.json`
- Modify: `apps/api/src/template-packages/template-package-release-validation.spec.ts`

- [x] TDD RED: assert all three managed definitions have eight fields, including integer `sort_order` bounded `0..9999`.
- [x] TDD RED: assert `system_page.homepage_top` accepts only `skinova-promo-strip@1`.
- [x] Add `sort_order` to all three definitions and the system-page slot; keep v1 untouched.
- [x] Run the focused validation spec; expected PASS.

## Task 2: Add pure strict projection

**Files:**

- Create: `apps/api/src/template-packages/skinova-managed-backfill.projection.ts`
- Create: `apps/api/src/template-packages/skinova-managed-backfill.projection.spec.ts`

- [x] TDD RED for exact seed result: 3 instances, 4 layouts, 5 placements; instance UUID equals banner UUID.
- [x] Test mapping: `name` to `displayName`; content to snake_case data; image UUID to `{ mediaId, alt: "", decorative: true }`; null media stays null.
- [x] Test definition mapping: top to promo, middle to consultation, article sidebar to article banner.
- [x] Test page mapping: homepage to `skinova-home@1`; `404` and `privacy-policy` to `skinova@1`.
- [x] Reject unknown pages/zones/placements, duplicate or ambiguous assignments, and unassigned non-article banners.
- [x] Prove canonical checksums are key-order-stable and change with every relevant source value.
- [x] Implement typed projection plus migration keys `skinova-v2-published-instance-v1`, `skinova-v2-page-placement-v1`, and `skinova-v2-article-placement-v1`.
- [x] Run the focused projection spec; expected PASS without DB.

## Task 3: Add atomic idempotent materialization

**Files:**

- Create: `apps/api/src/template-packages/skinova-managed-backfill.service.ts`
- Create: `apps/api/src/template-packages/skinova-managed-backfill.service.spec.ts`
- Modify: `apps/api/src/template-packages/template-package.module.ts`

- [x] TDD RED for successful import: 3 instances/revisions, 4 layouts/revisions, 5 placements, 8 provenance rows.
- [x] Assert each baseline points draft/approved/published to one revision, state `approved`, sanitizer policy null.
- [x] Assert legacy rows, site package pointers, and serialized public response are unchanged.
- [x] Assert identical retry is a no-op.
- [x] Allow missing-provenance repair only when the complete existing target exactly matches.
- [x] Make checksum drift, conflicting provenance, incomplete/altered targets, and unknown/ambiguous mapping roll back everything.
- [x] Implement via `DataSource.transaction`, not interactive draft APIs; load and validate registered `skinova-media@2`, contracts/templates, lock site/source rows, and validate the full projection before insert.
- [x] Create resources, baseline revisions, managed links/pointers, layouts, placements, and immutable provenance.
- [x] On retry compare checksum, identity, data, contract/template links, and the complete canonical placement set.
- [x] Register provider in `TemplatePackageModule`.
- [x] Run focused service spec; expected PASS.

## Task 4: Add explicit protected command and v2 scripts

**Files:**

- Create: `apps/api/src/template-packages/dto/backfill-skinova-managed-content.dto.ts`
- Modify: `apps/api/src/template-packages/template-package.controller.ts`
- Modify: `apps/api/src/template-packages/template-package.controller.spec.ts`
- Modify: `scripts/template-package-release.mjs`
- Modify: `package.json`

- [x] TDD RED: release-token endpoint validates site UUID, calls service once, and returns created/no-op counts.
- [x] Add dedicated internal POST endpoint.
- [x] Add CLI coverage for operation `backfill-managed-content`, required `--site-id`, and explicit v2 manifest path.
- [x] Extend CLI while preserving v1 default; validate manifest as a local JSON file.
- [x] Add explicit scripts for Skinova v2 registration and managed backfill; preserve v1 scripts.
- [x] Run focused controller/CLI specs; expected PASS.

## Task 5: One critical disposable-PostgreSQL check

**Files:**

- Create or modify one focused integration spec under `apps/api/src/template-packages/`
- Modify: `docs/managed-chunks-post-mvp-review.md`

- [x] On a disposable DB seed current Skinova, register v2, run explicit backfill.
- [x] Assert `3 / 4 / 5`, exact values/nulls/mappings, identical retry no-op, and full rollback for one representative conflict.
- [x] Assert legacy rows, public response, and site package pointers are unchanged.
- [x] Never run against shared working DB.
- [x] Record broader concurrency/history/shadow/runtime/UI/performance checks as deferred.

## Task 6: Focused verification and journal

**Files:**

- Modify existing Phase 3.2a entry: `docs/change-log.md`
- Modify as needed: `docs/managed-chunks-post-mvp-review.md`

- [x] Run only:

```powershell
pnpm --dir apps/api test -- --runInBand src/template-packages/template-package-release-validation.spec.ts src/template-packages/skinova-managed-backfill.projection.spec.ts src/template-packages/skinova-managed-backfill.service.spec.ts src/template-packages/template-package.controller.spec.ts
pnpm --dir apps/api build
```

- [x] Run the single disposable-PostgreSQL acceptance command from Task 5.
- [x] Run `git diff --check`, inspect `git status --short` and scoped diff: no secrets, unrelated files, applied-migration edits, runtime/UI changes, or pointer changes.
- [x] Update the existing journal entry with exact files, no-schema-change statement, explicit transactional/idempotent data operation, checks, and `Коммит реализации: не создан`.
- [x] Stop for review and offer one separate commit. Do not push, merge, deploy, or execute on shared/VDS DB.

## Self-review

- Registration and backfill stay separate and explicit; v1 stays untouched.
- Only current published state is imported; source rows, public runtime, and pointers remain unchanged.
- Stable IDs, exact layout identity, immutable provenance, canonical checksum, and fail-closed transaction make retries safe.
- Critical acceptance is exactly 3 instances, 4 layouts, 5 placements, plus exact no-op retry.
- No schema migration; noncritical checks remain in the deferred review document.
