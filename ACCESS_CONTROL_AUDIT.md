# Аудит текущей реализации прав Wispo CMS

> Это снимок исходного состояния до переработки. Фактический локальный статус
> реализации зафиксирован в `ACCESS_CONTROL_REWORK_PLAN.md` и
> `docs/change-log.md`.

Дата: 30 сентября 2026 года.

Ветка: `codex/access-control-v2`.
База сравнения: актуальная `origin/main` на коммите `7542ca9`.

## Краткий вывод

Система уже содержит серверную изоляцию сайтов, `PlatformAdminGuard`, immutable-ревизии, согласование конкретной версии, историю событий, preview и откат. Эти механизмы нужно переиспользовать.

Основная переработка требуется в модели назначений и вычислении возможностей. Сейчас пять прикладных ролей жёстко зашиты в БД, DTO, сервисы и интерфейс. Владелец автоматически получает доступ к коду и управлению пользователями, а прямой режим публикации без согласования отсутствует.

Бесшовный переход из платформы внутрь сайта уже реализован через History API без полной перезагрузки. Его не нужно писать заново — требуется привести оболочку и меню к новой матрице прав.

## Текущая модель данных

Сейчас используются:

- `PlatformRole.WISPO_ADMIN`, `EMPLOYEE` и legacy-значения;
- пять прикладных workspace-ролей плюс legacy-роли;
- одна запись `workspace_memberships` на пользователя и workspace;
- одна роль и массив `site_ids` в этой записи;
- `account_kind` и `home_site_id` в аккаунте.

Текущая таблица не может хранить разные `canEditCode` и `requiresApproval` для двух сайтов одного workspace. Рекомендуется отдельное назначение с уникальностью `user_id + site_id`:

- `role`: `SITE_OWNER` или `CONTENT_MANAGER`;
- `can_edit_code boolean default false`;
- `requires_approval boolean default false`;
- автор и время изменения прав для аудита.

`workspace_memberships` можно сохранить для workspace-модулей, включая Content Center, но не как единственный источник site-level прав.

## Управление пользователями

Уже правильно:

- все `/api/platform/*` защищены `PlatformAdminGuard`;
- email уникален;
- глобальный интерфейс создаёт пользователей, назначает сайты, отключает аккаунты и меняет временный пароль.

Не соответствует новой модели:

- `SiteUsersController` позволяет владельцу создавать менеджеров и разработчиков;
- `assertSiteOwner()` даёт владельцу управление пользователями;
- `SiteUsersView` находится в меню сайта;
- глобальная форма предлагает пять ролей;
- код разделяет `wispo`- и `site`-аккаунты;
- site-аккаунт ограничивается одним сайтом.

Нужно оставить управление аккаунтами и назначениями только глобальному администратору Wispo, убрать site-level создание пользователей и не использовать `account_kind/home_site_id` как источник авторизации.

## Серверные права

`hasSitePermission()` уже является центральной точкой, но основана на старых ролях:

- администратор — всё;
- владелец — всё, включая код и пользователей;
- разработчики — контент, код и публикация;
- менеджеры — контент и публикация.

Она используется в auth/session, content services, lifecycle, ревизиях, privacy, audit и Content Center. Её нужно заменить единым resolver возможностей для конкретного пользователя и сайта.

Критичные backend-файлы:

- `apps/api/src/database/entities.ts`;
- `apps/api/src/platform/platform.dto.ts`;
- `apps/api/src/platform/platform.service.ts`;
- `apps/api/src/platform/platform.controller.ts`;
- `apps/api/src/platform/site-users.controller.ts`;
- `apps/api/src/auth/auth.service.ts`;
- `apps/api/src/content/content.permissions.ts`;
- `apps/api/src/content/cms-revisions.service.ts`;
- `apps/api/src/content/content-lifecycle.service.ts`;
- `apps/api/src/content/content.service.ts`;
- metadata/site-resource revision services;
- privacy и audit services.

## Согласование и версионность

Можно сохранить:

- отдельную immutable-ревизию при сохранении;
- сброс одобрения после новой версии;
- optimistic check через `draftRevisionId`;
- согласование и публикацию конкретного revision ID;
- обязательную причину возврата;
- события submit/approve/return/publish;
- общий revision ledger для контента, шаблонов и чанков.

Требует изменения:

- `publishRevision()` всегда требует одобренную версию;
- `requiresApproval` в БД отсутствует;
- нет прямой публикации при выключенном согласовании;
- политика определяется ролью, а не назначением на сайт.

Нужно сохранить immutable-проверки, но выбирать маршрут по `requiresApproval`: прямой publish актуальной версии либо submit → approve → publish.

## Кодовые права

Уже есть `EDIT_CODE`, `PUBLISH_CODE`, типы `template/chunk`, HTML-валидация, preview, история и откат. Но владелец автоматически получает код, а доступ определяется ролью разработчика. Эти permission-ы нужно подключить к `can_edit_code` конкретного назначения.

## Интерфейс и навигация

Уже соответствует ожиданиям:

- `openSite()` меняет сайт, экран и URL через `history.pushState`;
- меню и рабочая область обновляются без reload;
- back/forward обслуживается через `popstate`;
- администратор возвращается к общему списку проектов.

Требует изменения:

- `canEditCode` автоматически включён владельцу;
- `canManageSiteUsers` приравнен к правам владельца;
- пункт «Пользователи» есть в меню сайта;
- возможности вычисляются в `page.tsx` из строки роли;
- `TeamAccessView` показывает пять ролей.

Основные frontend-файлы:

- `apps/web/src/app/page.tsx`;
- `apps/web/src/app/team-access-view.tsx`;
- `apps/web/src/app/site-users-view.tsx`;
- `apps/web/src/app/code-resources-editor.tsx`;
- revision-компоненты и редакторы сущностей.

## Влияние Content Center

Content Center уже объединён с нашей версионностью:

- workspace-доступ разрешается, только если пользователь покрывает все сайты workspace;
- публикация созданной статьи требует `APPROVE`, поэтому обычный менеджер не публикует самостоятельно;
- новый resolver должен использоваться и CMS сайта, и Content Center;
- публикация из Content Center должна учитывать `requiresApproval` целевого сайта.

Затрагиваются `workspace-access.ts`, `creation-publication.service.ts`, `creation.service.ts` и integration-тесты.

## Локальное контрольное состояние

- Docker-сервисы web, api, postgres и redis запущены и healthy.
- В БД 1 администратор Wispo и 3 site-аккаунта.
- Назначения: owner, content manager, developer и одна legacy-запись employee.
- В `workspace_memberships` нет code/approval flags.
- Тестовая площадка сейчас называется workspace `Luminava`, site `Skinova`; названия тестовые.
- В `cms_revision_resources` сейчас нет строк; data-migration revision pointers на существующих данных проверять не на чем, но механизм покрыт тестами.

## Baseline-проверка

Запущены:

- `content.permissions.spec.ts`;
- `revision-workflow.spec.ts`;
- `platform.user-access.spec.ts`;
- `cms-revisions.service.spec.ts`.

Результат: **4/4 suites, 41/41 tests passed**.

## Очерёдность изменения

1. Новая site-assignment сущность и миграция.
2. Единый серверный capability resolver.
3. Админские DTO/API управления назначениями и флагами.
4. Workflow прямой публикации и согласования.
5. Подключение code-permissions к `canEditCode`.
6. Обновление session/API contract и динамического меню.
7. Удаление управления пользователями из интерфейса владельца.
8. Совместимость Content Center.
9. Полная матрица unit/integration/UI-тестов.

Этап 0 считается закрытым после повторной проверки Git-состояния ветки и файлов аудита.
