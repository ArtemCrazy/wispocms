# Skinova v2 Registration MVP Implementation Plan

**Goal:** зарегистрировать реальный Skinova manifest v2 и его managed chunk contracts, не переключая сайт и не перенося legacy-данные.

**Architecture:** отдельный Skinova v2 manifest проходит существующий строгий managed validator. Общая release-validation граница принимает v1 либо v2; TemplatePackageService сохраняет package version и materializes contracts в одной транзакции через manager-aware repository method. V1 path остаётся без изменений.

## Критичный MVP scope

1. Добавить `manifest.v2.template.json` с тремя banner definitions и точными slot assignments Skinova.
2. Добавить release validator-dispatch для v1/v2 и разрешить v2 в DTO/service.
3. Добавить manager-aware contract registration и вызывать её атомарно при новой и повторной регистрации v2.
4. TDD проверить v1 compatibility, production Skinova v2 validation, atomic contract materialization и idempotent retry.
5. Запустить только связанные tests, API build и `git diff --check`.

## Вне этого шага

Backfill banners/assignments, legacy history adapter, shadow-read, activation,
runtime bindings, public/preview switch, API/UI, sanitizer/media lookup, VDS и
общая БД. Некритичные проверки записываются в post-MVP документ.