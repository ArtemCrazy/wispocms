# Managed Chunks: проверки после MVP

Этот список не блокирует текущий MVP. К нему возвращаемся отдельным этапом
после демонстрации и подтверждения основного сценария.

## Отложенные проверки

1. Проверить compatibility inventory на сайтах с очень большим числом
   instances/layouts. При необходимости заменить крупные `IN (...)` на `ANY`,
   join или пакетное чтение.
2. Разделить крупный `readCompatibilityInventoryUsingManager` на отдельные
   стадии чтения, индексации и проверки без изменения поведения.
3. Повторить полный PostgreSQL acceptance для fail-closed hardening, включая
   повреждённые связи и конкурентные операции, только на одноразовой БД.
4. Провести полный branch-wide regression, security review и проверку
   производительности после завершения пользовательского API/UI.
5. Разобрать существующий общий ESLint/Prettier baseline отдельно от этого
   функционала.
6. Выполнить CLI/API end-to-end регистрацию реального Skinova manifest v2 на
   одноразовой PostgreSQL-БД и проверить фактические строки contracts.
7. Расширить v2 race/concurrency matrix для одновременной регистрации package
   version и contracts; базовая идемпотентность уже покрыта unit-тестами.
8. После появления runtime bindings провести visual smoke трёх Skinova
   renderers и проверить preview/current switch.
9. Перед legacy backfill утвердить явное сопоставление `buttonText` →
   `button_text`, `linkUrl` → `link_url`, `mediaId` → `media_id`,
   `mobileMediaId` → `mobile_media_id`, `isActive` → `is_active`.

## Уже закрыто для MVP

- входные данные managed draft фиксируются до первого `await`;
- hook не может изменить фактические revision/resource metadata;
- проверяется именно новая revision, а не подставленная старая;
- битые present pointers не превращаются в ложный результат совместимости;
- схема БД, данные, API и UI этим hardening не менялись.