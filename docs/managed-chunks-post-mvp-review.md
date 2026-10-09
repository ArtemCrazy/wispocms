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
6. Добавить полноценный shadow-read: сравнивать публичный API/runtime output
   legacy и managed-модели до переключения package pointers.
7. Расширить v2 race/concurrency matrix для одновременной регистрации package
   version, contracts и двух запусков backfill на одном сайте.
8. После появления runtime bindings провести visual smoke трёх Skinova
   renderers и проверить preview/current switch.
9. Отдельно спроектировать перенос legacy draft/history, dual-write и
   восстановление повреждённого provenance; текущий MVP переносит только
   опубликованное состояние и fail-closed отклоняет расхождения.

## Уже закрыто для MVP

- входные данные managed draft фиксируются до первого `await`;
- hook не может изменить фактические revision/resource metadata;
- проверяется именно новая revision, а не подставленная старая;
- битые present pointers не превращаются в ложный результат совместимости;
- схема БД, данные, API и UI этим hardening не менялись;
- реальный Skinova manifest v2 зарегистрирован в одноразовой PostgreSQL-БД,
  contracts и backfill проверены одним focused acceptance;
- утверждён и покрыт mapping legacy banner → managed data, включая
  `sort_order`, image-object и сохранение null;
- backfill подтверждён для 3 instances, 4 layouts, 5 placements и 8 provenance
  rows; идентичный повтор является no-op, checksum conflict не оставляет
  частичных записей.

## Phase 4.1: отложено после API/UI MVP

1. Запустить API/Web на одноразовой PostgreSQL-БД, зарегистрировать Skinova v2,
   выполнить backfill и пройти полный create → save → review → publish →
   restore browser flow без изменения общей локальной или VDS-БД.
2. Провести full browser regression существующего sidebar, legacy banners,
   media delete и всех ролей/`requiresApproval`.
3. Проверить responsive/mobile, keyboard/screen-reader и pixel-perfect
   состояние списка, формы, picker и modal на реальных данных.
4. Добавить нормализованный индекс media references для исторических managed
   revisions, если продукт должен гарантировать восстановление удалённых файлов;
   до этого historical restore безопасно отклоняет отсутствующую media.
5. Добавить pagination/batch loading и устранить последовательный N+1 в
   catalog/instance list перед эксплуатацией больших каталогов.
6. Выполнить расширенную tenant/security/concurrency/performance матрицу,
   включая параллельные save/delete/restore и повреждённые contract chains.
