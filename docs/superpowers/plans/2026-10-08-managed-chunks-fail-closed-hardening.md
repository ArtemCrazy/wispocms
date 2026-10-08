# Managed Chunks Fail-Closed Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Не допустить публикационно-совместимого результата или managed draft при неполной typed-структуре.

**Architecture:** Prepared save возвращает типизированное доказательство ожидаемого instance/link либо layout/placements state. Сервис после hook повторно читает точные строки тем же transaction manager и только после совпадения двигает pointer. Inventory допускает только отсутствующий source pointer; любой присутствующий, но неразрешимый граф данных завершается общей безопасной ошибкой.

**Tech Stack:** NestJS 11, TypeScript 5.7, TypeORM, PostgreSQL 18, Jest 30, pnpm.

---

### Task 1: Post-hook managed draft verification

**Files:**
- Modify: `apps/api/src/content/cms-revisions.service.ts`
- Modify: `apps/api/src/content/cms-revisions.service.spec.ts`
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.repository.ts`
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts`

- [ ] **Step 1: Write failing service tests**

Добавить тесты, где no-op/wrong hook оставляет отсутствующий или неверный
instance owner/link и missing/extra/changed layout placements. Проверить, что
ошибка безопасна, а pointer/event не записаны. Отдельно сохранить успешные empty
layout placements.

- [ ] **Step 2: Verify RED**

Run:
`pnpm --dir apps/api test --runInBand -- content/cms-revisions.service.spec.ts template-packages/managed-chunk-persistence.repository.spec.ts`

Expected: новые negative cases FAIL на отсутствии post-hook verification.

- [ ] **Step 3: Implement typed expected proof and exact reread**

`prepare` возвращает `entityId` и discriminated proof: instance identity с
`contractId` либо layout identity с каноническим массивом placements. После hook
сервис читает owner/link/placements через переданный manager, сравнивает точные
идентичности и только затем позволяет `saveDraftInTransaction` сохранить pointer
и event. Общая ошибка не содержит внутренних идентификаторов.

- [ ] **Step 4: Verify GREEN**

Run команду Step 2.

Expected: обе suites PASS, включая rollback/no-pointer/no-event assertions.

### Task 2: Fail-closed compatibility inventory

**Files:**
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.repository.ts`
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.repository.spec.ts`
- Modify: `apps/api/src/template-packages/managed-chunk-persistence.database.spec.ts`

- [ ] **Step 1: Replace exclusion expectations with failing corruption tests**

Для каждого present source pointer проверить missing/wrong resource owner,
revision, typed instance link, package contract, malformed layout snapshot,
unknown placement instance и unresolved same-source instance pointer. Все случаи
должны возвращать одну безопасную ошибку без UUID; реально отсутствующий pointer
по-прежнему даёт отсутствующий source.

- [ ] **Step 2: Verify RED**

Run:
`pnpm --dir apps/api test --runInBand -- template-packages/managed-chunk-persistence.repository.spec.ts template-packages/managed-chunk-compatibility.spec.ts`

Expected: corruption cases FAIL, потому что текущий mapper молча пропускает их.

- [ ] **Step 3: Implement exact projection guards**

При наличии pointer требовать полный exact graph и бросать один безопасный
`ConflictException` при любой неполноте. Не добавлять fallback между draft и
published и не включать payload в выборки или ошибку.

- [ ] **Step 4: Verify GREEN and PostgreSQL acceptance**

Run focused suites выше, затем opt-in disposable PostgreSQL suite по существующей
безопасной Task 7 процедуре. Expected: focused PASS; database 32/32 или больше
PASS; test container/port/temporary volumes очищены, рабочие контейнеры не
затронуты.

### Task 3: Final regression and documentation

**Files:**
- Modify: `docs/change-log.md`

- [ ] **Step 1: Run selected Phase 1–2 suites and API build**

Expected: все selected tests и build PASS; scoped changed-file ESLint/Prettier и
`git diff --check` PASS.

- [ ] **Step 2: Review scope and database impact**

Проверить, что migration/entity schema/data/backfill/API/UI/VDS не изменены,
`origin/main` остаётся предком ветки и merge-tree не содержит конфликтов.

- [ ] **Step 3: Close journal entry and commit**

Записать точные команды и результаты, статус `Готово, не выложено`, commit hash;
push/merge/deploy не выполнять без отдельного подтверждения пользователя.