# Wispo CMS — журнал параллельных доработок

### 2026-10-07 · Слияние site-scoped публикации на сервер заказчика

- Статус: **В работе**. Артём / Codex, ветка `feature/creation-publication-stage-7`: по поручению пользователя проверить и слить `origin/codex/site-scoped-publication-main-sync` (`c43c462`, реализация `a4660b4`) поверх `8de3465`.
- Область: права публикации на исходном/целевом сайте, транзакционная проверка структурных изменений CMS-ревизий и согласованность формы публикации. Риск Tier 2 — авторизация; review ограничен diff и непосредственными потребителями. Схема БД, миграции, формат данных не меняются. Существующие тесты владельца принимаются как evidence; повторяем только целевые проверки слияния и production gate.
- Перед выкладкой сверить текущие runtime-образы/миграции VDS и сохранить свежую резервную копию. Рабочие данные и публикации для smoke не изменять. Доработка автоматической доставки frontend-пакетов в этот релиз не входит.

### 2026-10-06 · Слияние обновления Романа: граница кода и frontend-пакеты

- Статус: **слито и выложено на VDS заказчика**. Артём / Codex: merge `0d20f84` объединяет `b75a1be` и `efa36d4` из `origin/codex/access-control-v2` с `30ff0b6`; финальный код `8d817b0`. Наши доработки контент-центра, безопасной публикации и оформления статьи сохранены. Форма публикации учитывает `canManageStructure`: менеджер контента не выбирает шаблон; владелец/администратор выбирает готовый вариант. Ключи шаблонов с двоеточием не повреждаются.
- Проверки: API Jest 119 suites / 889 tests passed (5 opt-in suites / 78 tests skipped); контент-центр 18/18; package runtime/UI 9/9; release CLI 21/21; web TypeScript и точечный ESLint — PASS. Production-сборки API и web прошли. Интеграционные тесты на рабочей БД не запускались.
- Три миграции сначала проверены на изолированной копии production-БД: ledger 48 → 51, повторный запуск без изменений, количество сайтов, пользователей, статей и ревизий сохранено. Затем применены в production. Добавлены guarded-скрипты `scripts/verify-package-upgrade.cjs` и `scripts/verify-package-old-code.cjs`. Откат API требует сначала аддитивно восстановить `site_accesses.can_edit_code` и значения из резервной копии, затем переключить старый образ: только переключения образа недостаточно. Этот сценарий проверен на изолированной БД; destructive down в production запрещён.
- Резервные копии перед миграциями: `/root/wispo-cms-backups/wispo-20261006T154546Z.sql.gz` (SHA256 `7e84df6bea349f18e25786f5a14874edae1611a2973cff55ce2ef78a1cd062fa`), `wispo-media-20261006T154546Z.tar.gz` (`35ce101d98c5da52184ada03d71c53966d261908e1be07ba14eb6cfb83516ed1`) и `wispo-code-before-packages-20261006.tar.gz` (`14b1a018737111f6ca450d304c3538eba95988c361ebad3785d5b995976e393f`). Скопированы в `E:/backups/Wispo-CMS-archive-20260924/customer/`, хеши совпадают. Архив кода включает приватные настройки, в Git не добавлен.
- Инцидент выкладки: первая новая web-сборка скомпилировалась, но standalone-образ не включил ESM-файлы `@swc/helpers`, вызвав HTTP 502. Web оперативно возвращён на предыдущий образ; новый API оставался healthy. Исправлены каноническая сборка через `pnpm --filter web build` и tracing workspace-store в `next.config.ts`. Образ `8d817b0` сначала запущен в отдельном контейнере без сети, проверен HTTP-ответ, затем переключён в production в 15:52 UTC. Итоговые образы: API `189d3ea7e99a`, web `6d236de24fe1`; оба healthy. Предыдущие runnable-образы сохранены под `before-packages-0d20f84`.
- После выкладки: API health OK; Skinova, Crazy Studio Test, Wispo Media и Armaturex — HTTP 200; служебный register без авторизации — 401. Во встроенном браузере в администраторской сессии проверены команда/форма пользователя без права на код, каталог шаблонов и пустой реестр frontend-пакетов, история версий и текущая статья. Проверены применённые стили статьи через DOM: семантический article, заголовки 24px, компактные действия 32px, межстрочный интервал абзацев 23.8px. Запуск AI, изменение пользователей и публикация контента при smoke не выполнялись.
- Реестр показывает зарегистрированные версии; физическое переключение/rollback артефактов из CMS в эти коммиты не входит. Пакеты существующих сайтов ещё не зарегистрированы. `WISPO_RELEASE_TOKEN` не добавлялся; служебный API остаётся закрытым. Настройки SMTP не менялись.
- Удалены только созданные для проверки контейнеры `wispo-release-check-20261006`, `wispo-web-smoke-8d817b0` и точно идентифицированные промежуточные сборочные образы; рабочие volumes и резервные копии не затронуты. После очистки на VDS свободно 4.5 ГБ. Сборочные слои можно воссоздать из Git, рабочие/предыдущие runtime-образы сохранены.

### 2026-10-02 · Автоматическая регистрация frontend-релизов

- Статус: **реализация и локальная проверка Tasks 1–9 завершены; подтверждено
  оформление отдельного локального commit в `codex/access-control-v2`**.
- Коммит реализации: `feat: add frontend package release registry` — включает
  код, миграции, тесты, архитектурную документацию и эту запись журнала. Push,
  merge в `main` и выкладка не выполняются.
- Текущий этап: Task 9 — итоговый интеграционный прогон реестра frontend-пакетов
  Skinova — **завершён локально**. Созданы только временные объекты
  `wispo-task9-20261003-*`: отдельные PostgreSQL, network и volume; рабочая
  локальная БД, OpenServer, VDS, `main` и общий сервер не использовались.
  На пустой БД штатный `bootstrap-local-database` применил первые 16 миграций и
  обязательные локальные prerequisites, затем применены остальные: итоговый
  ledger содержит 51 миграцию, включая `TemplatePackageRegistry1791789600000`
  и `AssignSkinovaSystemTemplate1791793200000`. Новый integration spec имеет
  fail-closed guard на literal `127.0.0.1`, protocol, порт, имя БД и отдельный
  opt-in; query/fragment URL запрещены, поэтому параметры PostgreSQL не могут
  переопределить проверенный authority.
  Проверены register, идемпотентный повтор, конфликт digest, read-only
  preflight, неизменность public manifest/site catalog до report-deployed и
  неизменность реального каталога `site_content_templates` также при
  report-deployed, появление current только после report-deployed, legacy
  `NULL`, mismatch и системный audit. Реальный CLI запускался из отдельного
  чистого Git snapshot с ephemeral commits; защита от dirty release inputs не
  ослаблялась.
- Файлы Task 9: добавлен
  `apps/api/src/template-packages/template-package.integration.spec.ts`,
  обновлены `docs/react-site-architecture.md` и эта существующая запись
  журнала. Схема БД, migrations и формат сохраняемых значений в Task 9 не
  менялись; все созданные package/audit данные находились только в disposable
  БД. После проверок временные PostgreSQL container, network, volume и Git
  snapshot удалены по их точным именам; рабочие контейнеры остались запущены.
  Data-migration/backfill для внешних окружений отсутствует.
- Проверки Task 9: integration lifecycle и DB guard — 4/4; полный API Jest —
  118 suites и 885 tests passed, 6 opt-in suites skipped; API build — PASS; новый spec
  ESLint — PASS; web `tsc`, ESLint и build — PASS; root build через
  `npm run build` — PASS; isolated Playwright package workflow — 10/10.
  Полный общий API ESLint по-прежнему сообщает 9 существовавших ошибок в
  `ai`/`content-center` spec-файлах. Общий web contract-набор: 168/170; две
  существовавшие несвязанные проверки ожидают прежнюю навигацию статей и старый
  404 contract. Эти legacy-ошибки не маскировались и Task 9 их не меняет.
  До подтверждения этап оставался без commit. Push, merge в `main`, физическая
  выкладка, активация и rollback не выполнялись.
- Предыдущий этап: Task 8 — read-only состояние frontend-пакета на странице
  «Шаблоны» — завершён локально; итоговые spec- и quality-review получили
  статус **APPROVED**. Владелец видит
  только текущую версию, Wispo admin — текущую версию и совместимых кандидатов,
  content manager не получает пункт меню и не рендерит раздел; отдельный
  `isWispoAdmin` не подменяется структурным правом. Preview-ссылки отображаются
  только из ответа API, действий активации, rollback, загрузки manifest и
  release token в UI нет. Ошибка release-read остаётся внутри package-панели и
  не блокирует существующий каталог шаблонов. Схема и данные БД в Task 8 не
  изменяются. Первый spec-review вернул три Important: stale cross-site race,
  ложноположительный manager workflow без доказанной hydration и недостаточное
  покрытие loading/empty/error. Все три замечания закрыты отдельным TDD-циклом;
  quality-review затем вернул одно Important и два Minor: current ожидал
  candidates, длинные identifiers могли расширять mobile-панель, а полный Git
  revision был доступен только через hover title. Все три замечания также
  закрыты отдельным TDD-циклом; повторный quality-review завершён со статусом
  **APPROVED**.
- Текущий этап: Task 7 реализован и после обрыва соединения продолжен с
  итогового quality/security-review. Review не выявил Critical, но вернул
  четыре Important: digest должен строиться из точного Git tree и закрывать
  dirty/symlink-входы; охватывать все public/preview entrypoint Skinova;
  граф импортов должен разбираться AST-парсером с fail-closed динамическими
  импортами; release token допустимо отправлять по HTTP только на строгий
  loopback. Все четыре замечания закрыты локально и проверены. Повторный quality-review
  запросил ещё четыре локальных исправления: включить convention build-config
  в release digest/dirty scope, корректно разбирать CSS import, запрещать
  gitlink/non-regular Git entries и гарантированно очищать request timeout при
  pre-network ошибке. Все четыре повторных замечания закрыты локально;
  новый re-review выявил, что opaque YAML/lock/Dockerfile ошибочно проходили
  через Babel parser. Type routing исправлен и проверен локально. Финальный
  повторный review завершён со статусом **APPROVED**; Task 7 завершён локально.
  На тот момент общий блок Tasks 1–9 оставался **в работе**; сейчас локальная
  реализация и проверка блока завершены. Commit/push/выкладка не выполнялись.
  Добавлена локальная CI-like команда Skinova с независимыми операциями
  register, preflight и report-deployed. Один запуск выполняет ровно одну
  операцию; регистрация не вызывает preflight или deploy-report. Схема и
  данные БД в Task 7 не изменяются; команда работает только через внутренний
  API.
- Текущий review: повторная проверка manifest-валидатора выявила и закрыла
  обход запрета на кодовые поля через составные имена (`rawHtml`,
  `templateHtml`, `componentJsx` и варианты с разделителями). Token-aware
  классификация сохраняет допустимые бизнес-поля `sourceUrl` и `postcode`.
  Review Task 5 закрыл две Important-регрессии: гонки уникальных вставок и
  атомарность доменной мутации с audit/no-op retry. Исправления выполнены
  отдельным TDD-циклом без запуска БД.
  Edge-review также закрыл package-race с разными версиями и сериализацию
  concurrent deploy-report через row lock. Последующий security-review закрыл
  сохранение query/fragment в repository и external runtime URL; отдельный
  TDD-контракт запрещает эти части URL, сохраняя допустимые path/port.
  Quality-review Task 6 разделил deployed compatibility и lifecycle кандидата:
  current сохраняет `ready|mismatch` и безопасные причины, а в candidates
  попадают только совместимые версии со статусом `registered`. Также устранена
  загрузка JSONB manifest на обычных public/preview путях: identity читается
  отдельным узким TypeORM select по обоим pointer сайта.
- Владелец / задача / ветка: Roman; реестр `TemplatePackage`, автоматическая
  регистрация кандидата из CI/служебной команды и точная фиксация фактически
  развёрнутой версии на
  примере Skinova; `codex/access-control-v2`.
- Что изменяется и зачем: проектируется связь конкретной сборки React-сайта с
  CMS без хранения и редактирования исходного кода. Промежуточные Git-коммиты
  CMS не регистрирует; только проверенная сборка становится неизменяемым
  кандидатом. Физическая активация и rollback отнесены к отдельному следующему
  этапу с неизменяемыми build-артефактами.
  Ручная загрузка manifest через интерфейс администратора не планируется.
- Файлы / модули: архитектурная спецификация и implementation plan; в Web
  добавлены сериализуемый manifest template Skinova с фактическими draft-07
  схемами сохраняемых CMS entity data и явными requirements route context,
  package-aware runtime catalog, отдельные строго типизированные React
  component bindings шаблонов/баннерных renderer и совместимые re-export
  прежних Skinova-констант. Встроенные `articles_list`, `header` и `footer`
  описаны как integrated capabilities существующих поверхностей, а не как
  ложные самостоятельные компоненты. Nullable-поля статьи совпадают с
  `ArticleEntity`, а runtime context ограничен типизированным словарём реальных
  props renderer; route adapters явно собирают эти ключи. Для реального
  исполнения schema/binding тестов добавлены локальные dev-зависимости Ajv и
  tsx. Public/CMS-preview главной, статьи и категории, системные страницы и
  banner preview переведены на общий package-aware resolver. Неизвестная
  identity больше не выбирает Skinova неявно; 404 использует собственные
  `template.key/version`, а не шаблон header. Реализованы API-типы, opaque DTO,
  строгая серверная валидация manifest и отдельный fail-closed `release-token`
  guard. Валидатор проверяет точную структуру, числовые версии и совместимость
  CMS API 1.2, уникальность template identity, slot key и renderer, optional
  nullable `artifactDigest`, лимиты размера,
  глубины и количества узлов, чистые JSON-значения, отсутствие исходного или
  исполняемого кода и компиляцию каждой schema строгим Ajv как draft-07.
  Repository принимает только HTTPS без credentials, query и fragment;
  runtime URL принимает HTTP(S) без credentials, query и fragment и отклоняет
  literal IP, localhost, single-label и служебные/private suffix. URL path и
  явный port остаются допустимыми. Remote JSON Schema references запрещены. Guard
  читает секрет только из `WISPO_RELEASE_TOKEN`, принимает его только через
  `x-wispo-release-token`, сравнивает SHA-256 buffers через timing-safe compare
  и не возвращает значение в ошибке. Ajv добавлен runtime-зависимостью API;
  источником lock остаётся только корневой workspace lockfile.
  Task 5 добавила `template-package.service/controller/module`, подключение к
  `AppModule` и безопасный системный метод `AuditService`: три internal-route
  доступны только по release token, API активации и rollback отсутствуют.
  Task 6 добавила отдельные пользовательские read-controller: владелец сайта и
  Wispo admin читают только текущую фактически развёрнутую версию, а список
  кандидатов того же стабильного пакета доступен только Wispo admin. Public и
  preview payload содержат nullable identity текущего пакета; integration
  manifest 1.2 возвращает безопасную сводку версии и поддерживаемые template
  identity без полного manifest. Preview URL формируется сервером: текущий
  embedded build, включая его строку в candidates, использует штатный
  `/preview/:siteSlug`, external-кандидат — только сохранённый после валидации
  `runtimeUrl`, а ещё не развёрнутый embedded-кандидат — `null`.
  Task 7 добавила `scripts/template-package-release.mjs` и реальный CLI
  contract-test. Полный manifest строится из versioned template с точным
  `git rev-parse HEAD`, детерминированным canonical UTC `builtAt` из timestamp
  того же Git commit (`git show -s --format=%cI HEAD`), `artifactDigest: null` и
  детерминированным SHA-256 по canonical manifest без самоссылочных build-полей,
  полному набору фактических route/runtime entrypoint. Next entrypoint
  (`page`, `route`, `layout`, `not-found`, `error`, `loading`, `template`)
  динамически обнаруживаются под preview-корнем; отдельно включены proxy,
  корневой layout, banner preview и runtime registry/catalog. Их рекурсивный
  локальный import-граф разбирается AST-парсером (static/side-effect import,
  export-from/export-namespace, literal `require` и dynamic import), а
  `public/skinova/**` включается рекурсивно. Комментарии и строки не создают
  ложных зависимостей; нелитеральный dynamic import/require, неразрешимый
  локальный импорт, symlink и gitlink закрывают выпуск безопасной ошибкой.
  CSS import разбираются comment-aware scanner для quoted и unquoted
  `url(...)` форм. В graph/digest/dirty gate также входят фактические
  convention build inputs: Next/PostCSS/TypeScript config, Web package и
  Dockerfile, корневые package/workspace/lock. Dependency scan выполняется
  только для JS/TS variants и CSS; JSON, YAML, lock, Dockerfile и остальные
  convention inputs фреймируются как opaque Git bytes.
  Относительные импорты и настроенный alias `@/` разрешаются с
  extension/index semantics.
  Имена POSIX-путей и raw bytes фреймируются длиной и сортируются побайтно.
  Все bytes manifest, source graph и public assets читаются из exact Git tree
  указанного HEAD, а не из платформенно-зависимого checkout; relevant
  tracked/untracked изменения запрещают запуск до HTTP-запроса. Это устраняет
  расхождение revision/digest и CRLF/LF между Windows и Linux.
  Token берётся только из env и отправляется только release-token header;
  remote API допускается только по HTTPS, а HTTP — лишь для literal loopback
  `127.0.0.1`/`::1`; вывод и HTTP/network ошибки используют безопасный
  allowlist. В корневом
  `package.json` добавлены три отдельные команды, а local env/compose получают
  только placeholder/config без реального секрета.
  Task 8 добавила на существующую страницу «Шаблоны» отдельную read-only
  package-панель со статусами загрузки, пустого состояния, несовместимости и
  локальной ошибки. Текущая фактически развёрнутая версия читается владельцем
  и Wispo admin; совместимые зарегистрированные кандидаты запрашиваются и
  показываются только Wispo admin. Длинные revision/digest безопасно
  переносятся, preview-ссылка использует только серверный `previewUrl`, а
  адаптивные стили переиспользуют действующие токены и типографику CMS.
  Переключение сайта защищено одновременно `key` компонента, AbortController и
  монотонным request sequence: запоздавшие current/candidates/error/finally
  предыдущего сайта не меняют новый экран. Ошибки current и candidates
  независимы, поэтому недоступный список кандидатов не скрывает успешно
  прочитанную текущую версию. Current и candidates имеют раздельные loading-
  lifecycle: быстрый current отображается сразу и не ждёт даже неопределённо
  долгий candidates request. Полный Git revision current и каждого кандидата
  присутствует в rendered DOM, а 100-символьные package id/version и digest
  переносятся без горизонтального переполнения mobile-панели. Прямой URL
  закрытого раздела «Шаблоны» для content manager заменяется на доступный
  корневой экран сайта.
- БД — схема: добавлена, но не применялась ни к одной БД, аддитивная миграция
  `TemplatePackageRegistry1791789600000`. Она создаёт `template_packages` и
  неизменяемые `template_package_versions`, nullable-ссылки пакета и текущей
  версии в `sites`, индексы, FK и DB-trigger запрета изменения записанной
  версии. Составной FK и CHECK не позволяют связать сайт с версией другого
  пакета. Каталог `site_content_templates` принимает новые виды `homepage` и
  `system_page`; существующие строки миграция не меняет. Manifest хранится как
  JSON-объект формата 1 вместе с canonical digest, release/artifact digest,
  Git revision, диапазоном CMS API и runtime-данными.
- БД — данные и формат: добавлена, но не применялась ни к одной БД, отдельная
  идемпотентная миграция `AssignSkinovaSystemTemplate1791793200000`. Она
  назначает `skinova@1` текущим и опубликованным системным шаблоном только
  импортированной странице `privacy-policy` при одновременном совпадении
  точных ID страницы и сайта, slug страницы и сайта и только если все четыре
  поля identity равны `NULL`. Остальные сайты и страницы не затрагиваются.
  Реестровая миграция не создаёт фиктивный commit, digest или версию Skinova;
  после запуска кода локальная CI-like команда отдельно зарегистрирует и
  отметит фактически развёрнутую сборку.
  Task 5 БД не запускала и реальные данные не меняла. При будущем вызове
  registration создаёт только пакет/immutable-версию с вычисленным сервером
  canonical digest; preflight пишет только безопасный audit; deploy-report
  транзакционно обновляет два package-pointer сайта и audit, не изменяя
  `site_content_templates` даже при mismatch. При PostgreSQL `23505` первая
  transaction откатывается, затем одна новая transaction повторяет полный
  `registerCandidate`: это позволяет создать другую версию уже победившего
  package. Только при втором `23505` выполняется финальный refetch/compare
  identity, release digest и canonical manifest; другие ошибки БД не
  маскируются. Audit регистрации и фактического изменения deployed pointer
  пишется тем же `EntityManager`; no-op retry audit не дублирует, а ошибка audit
  откатывает доменную мутацию. Deploy-report берёт `pessimistic_write` lock на
  Site до проверки pointer; read-only preflight lock не использует.
  Task 6 выполняет только чтение, audit не пишет, schema/data migration и
  ручные изменения данных не добавляет; БД не запускалась. Task 7 также не
  меняет схему, формат сохраняемых значений или данные и не подключалась к БД.
  Task 8 меняет только Web UI и изолированные тесты: схема, формат сохраняемых
  значений и данные БД не затронуты; тесты работают через route interception и
  к БД не подключаются.
- Совместимость / пересечения с параллельной работой: текущие опубликованные
  сайты продолжают работать без активного frontend-release; новая проверка
  включается только после явной служебной регистрации и deploy-report пакета.
- Проверки и оставшиеся ограничения: TDD RED зафиксирован отсутствующим
  manifest/plain runtime catalog, затем прямыми route/banner ветками Skinova.
  После реализации schema/runtime contract-набор — 17/17, executable TSX
  bindings — 3/3, TypeScript, ESLint изменённых файлов и production Web build
  — успешно. Для схемы и точечного Skinova-backfill отдельно зафиксирован TDD
  RED, затем целевые migration/data-source тесты — 11/11, ESLint изменённых
  API-файлов и production API build — успешно. Для manifest/guard отдельно
  зафиксирован TDD RED; security-review regressions отдельно дали ожидаемый
  RED (28 тестов и ещё 3 для path-aware `source`), после исправления итоговый
  целевой набор manifest/guard — 114/114, ESLint всех новых файлов и production
  API build — успешно.
  Для Task 5 отдельно зафиксирован ожидаемый RED на отсутствующих service,
  controller и system audit. Review-race/atomicity тесты отдельно дали
  ожидаемый RED на семи проверках; два дополнительных edge-race теста также
  дали ожидаемый RED. URL security-review отдельно дал ожидаемый RED: 4 новых
  проверки не отклоняли query/fragment при 105 остальных успешных; после
  исправления validator — 109/109. Итоговый расширенный набор Task 4+5 —
  144/144, адресный ESLint и production API build успешны. Тесты используют
  repository-mocks и не подключаются к локальной или внешней БД.
  Для Task 6 зафиксирован ожидаемый RED: отсутствовали manifest schema 1.2,
  package identity в public/preview, методы `current`/`candidates` и
  пользовательские read-controller. После реализации целевой набор — 34/34,
  полный API unit/regression suite — 884/884 при 76 штатно пропущенных тестах,
  адресный ESLint и production API build успешны. Проверены owner-only доступ
  к своему site/current, запрет для content manager и чужого владельца,
  platform-admin-only candidates, legacy `NULL`, отсутствие full manifest и
  отсутствие мутаций/audit.
  Quality-review отдельно дал ожидаемый RED на четырёх проверках: current
  embedded candidate имел `previewUrl: null` и compatibility status вместо
  lifecycle status, несовместимый кандидат не фильтровался, обычный public
  payload загружал полную version relation, а preview без неё терял identity.
  После исправления единый Task 3–6 regression-набор — 172/172, адресный
  ESLint и production API build успешны; две новые TypeScript-ошибки в
  `template-package.read.spec.ts` устранены без правок исторических ошибок
  других тестов. Полный manifest загружается только endpoint integration
  manifest; public/preview используют narrow select `packageId/packageVersion`.
  Validator нормализует завершающую точку hostname, принимает только canonical
  UTC `builtAt` с секундами либо миллисекундами и проверяет полный lowercase
  SHA или безопасный Git ref. Точные поля исходного/исполняемого кода
  отклоняются, включая вложенный `source`; обязательный корневой
  `manifest.source` разрешён явно. Harmless HTML-разметка и техническая проза в
  JSON Schema не считаются кодом без высокодостоверного executable-признака.
  DTO тестируется с фактическим
  глобальным режимом `whitelist`: вложенный manifest остаётся непрозрачным для
  предварительного strip и неизвестные/опасные поля доходят до строгого
  валидатора. TypeORM metadata отдельно
  собрана без подключения к БД: две колонки сайта, одиночный и составной FK и
  обе уникальности версии разрешаются корректно. Миграции намеренно не
  запускались: проверка на отдельной БД остаётся для интеграционного этапа.
  Статическая URL-проверка не выполняет DNS resolution, поэтому защита от DNS
  rebinding должна дополнительно обеспечиваться сетевой политикой preview-
  окружения; сам API по runtime URL сетевые запросы не выполняет. Task 5
  реализовала идемпотентную служебную регистрацию кандидатов, read-only
  preflight и транзакционный deploy-report с безопасным системным аудитом;
  регистрация не
  меняет каталог шаблонов и текущие указатели сайтов. Пользовательский read API
  реализован в Task 6; Task 7 добавила локальную CI-like команду. CI/CD и
  отдельный репозиторий Skinova пока только моделируются служебной командой;
  внешняя автоматизация и VDS не затрагиваются. Для Task 7 зафиксирован
  ожидаемый RED 0/6 на отсутствующем release CLI; отдельные regressions дали
  RED 5/6 на stale self-referential build-полях и 6/7 на token-forwarding
  через redirect. Spec-review TDD отдельно зафиксировал RED на разных `builtAt`
  у двух неизменившихся регистраций, отсутствии import-safe collector,
  зависании принятого, но не отвечающего HTTP-запроса и отсутствии безопасной
  проверки некорректного Git timestamp; все четыре класса регрессий закрыты.
  Итоговый behavior-набор после повторного quality/security-review — 21/21.
  Повторный TDD-цикл сначала дал ожидаемый RED 0/6 на build inputs, CSS import,
  gitlink и timeout lifecycle, затем GREEN 6/6. Re-review type routing отдельно
  дал RED 0/2 на production-like YAML lock/Dockerfile bytes, затем GREEN 2/2.
  Полный набор проверяет
  методы/path/body/header каждой независимой операции,
  два полностью одинаковых manifest для одного Git commit/tree, canonical
  digest, независимость от traversal order, mtime и CRLF checkout,
  чувствительность к committed transitive bytes/path, полный preview route
  discovery и AST/CSS import graph, fail-closed dirty tracked/untracked
  source/build inputs, symlink/gitlink, nonliteral dynamic import/require и
  missing local import, а также отсутствие request timer до успешной сборки
  body,
  обязательный env token, запрет redirect, ограниченный timeout, отсутствие
  утечек, strict HTTPS/loopback policy и безопасное сообщение 409 о повышении
  `packageVersion`. Binary/font coverage рекурсивного collector проверена
  fixture-файлом WOFF2; защита symlink дополнительно проверена mutation RED
  (без проверки mode тест падает, после восстановления GREEN 1/1). Текущий
  intentionally dirty root корректно не может
  выпустить релиз до утверждённого коммита; lifecycle Task 9 должен выполняться
  на committed tree. Task 3–6 API regression — 12 suites / 172 tests.
  Node 22 syntax, загрузка Babel parser, compose config, Web production build
  и API production build проверены локально. Nested
  lockfile, `pnpm-workspace.yaml`, БД, VDS и внешние сервисы не изменялись.
  Для Task 8 до production-кода зафиксирован ожидаемый RED role/UI-контракта
  0/4; после реализации контракт — 4/4, релевантные Web contract-регрессии —
  25/25. Первый review-TDD отдельно дал ожидаемый RED: manager оставался на
  закрытом `view=templates`, delayed response сайта A перезаписывал уже
  выбранный сайт B, а ошибка candidates скрывала успешно прочитанный current;
  по группе resilience остальные loading/null-current/current-error сценарии
  уже проходили 3/4. После исправления полностью изолированный Playwright
  workflow — 8/8. Quality-review TDD отдельно дал ожидаемый RED 0/3: current
  не появлялся до завершения deferred candidates, full source revision не был
  найден в DOM, а mobile-панель с 100-символьными валидными identifiers имела
  `scrollWidth > clientWidth`. После исправления эти сценарии — 3/3, полный
  изолированный workflow — 10/10. Финальная родительская перепроверка также
  дала contract 4/4, workflow 10/10, TypeScript/ESLint без ошибок и успешную
  production Web build; desktop/mobile screenshots сохранены вне репозитория.
  Workflow проверяет current+candidates для Wispo admin, current-only и
  отсутствие platform-запроса для владельца, отсутствие меню/страницы и всех
  release-read запросов для content manager после положительной проверки
  hydration/доступного экрана, серверный preview URL, отсутствие release-
  мутаций, stale cross-site response, delayed loading, пустое состояние и
  независимые current/candidates loading/errors при рабочем каталоге шаблонов,
  полный Git revision в DOM и mobile wrapping длинных identifiers. Web
  TypeScript, адресный ESLint и production build успешны.
- Коммит реализации: не создан — только после локальной проверки и
  подтверждения владельцем.
- Выкладка: не было. `main`, GitHub, VDS и внешние БД не изменялись.
- Восстановление: `down()` схемы отказывается удалять реестр, пока существуют
  пакеты, версии, привязки сайта или строки новых template-kind. `down()`
  data-миграции снимает назначение только при полном совпадении точной строки и
  всех четырёх значений `skinova@1`; отдельного provenance-маркера у присваивания
  нет, поэтому это best-effort защита. Destructive down на внешней БД не
  запускается вместо штатного восстановления; нужны резервная копия и
  предварительная проверка на отдельной БД.

### 2026-10-02 · Удаление редактирования кода из CMS

- Статус: **Готово, не выложено**.
- Владелец / задача / ветка: Roman; удаление редактирования исходного кода из
  CMS и фиксация React-архитектуры; `codex/access-control-v2`.
- Что изменено и зачем: React-код шаблонов и компонентов остаётся в Git
  соответствующего сайта. CMS сохраняет и версионирует данные экземпляров,
  назначения готовых шаблонов и JSON-конфигурацию, но не HTML/JSX/CSS. Удалены
  `canEditCode`, HTML-редактор, API `code-resources` и активные кодовые типы
  ревизий `template`/`chunk`. Управление структурой через готовые шаблоны
  доступно только администратору Wispo и владельцу сайта; контент-менеджер не
  может подменить шаблон через интерфейс или прямой API-запрос. При повторной
  публикации из Контент-центра его прежний шаблон сохраняется, при первой
  публикации или переносе сервер выбирает системный шаблон целевого сайта.
  Те же ограничения действуют для общего versioned API, восстановления старых
  ревизий, legacy-восстановления и дублирования статьи/категории: менеджер
  сохраняет текущий шаблон либо получает системный, владелец/admin может
  восстановить или скопировать назначение целиком.
- Файлы / модули: права и сессия (`auth`, `content.permissions`, `platform`),
  ревизии и шаблонные назначения (`content`, `privacy`, `content-center`),
  миграция и сущности БД, Web-интерфейсы доступа/контента/шаблонов/политики,
  contract- и браузерные тесты. Добавлены
  `docs/react-site-architecture.md` и план реализации; аудит и план прав
  обновлены с исторической пометкой для прежнего редактирования кода.
- БД — схема: новая миграция
  `RemoveCmsCodeEditing1791703200000` зарегистрирована в `data-source.ts` и
  выполнена только на локальной БД. Она удаляет только
  `site_accesses.can_edit_code`; таблицы контента, назначений и истории не
  удаляет. Read-only проверка локальной БД подтвердила одну запись миграции и
  отсутствие колонки.
- БД — данные и формат: backfill и ручных изменений рабочих данных нет.
  Исторические строки ревизий `template`/`chunk` сохранены, но активный API их
  больше не создаёт. Из контракта доступа удалён `canEditCode`; в публикации
  Контент-центра `templateKey/templateVersion` стали необязательными для
  контент-менеджера, а фактическое назначение вычисляет сервер. Для интеграции
  использована отдельная локальная БД `wispo_cms_tests`; рабочая БД тестами не
  затрагивалась.
- Совместимость / пересечения с параллельной работой: старый код, ожидающий
  колонку `can_edit_code`, несовместим со схемой после миграции. Так как API
  запускает миграции через `migrationsRun: true`, код и миграцию на внешнем
  окружении нужно применять согласованно, после сверки чужих миграций и
  резервной копии. Служебные файлы и изменения коллеги не включаются.
- Проверки и оставшиеся ограничения: полный API unit-набор — 731 успешно, 76
  пропущено и 0 ошибок; целевой набор альтернативных versioned/restore-путей —
  65/65; интеграция Контент-центра на
  отдельной БД — 22/22; целевые Web contract-тесты — 21/21; Playwright — 24/24;
  ESLint изменённых production- и затронутых test-файлов без ошибок; production-
  сборки API и Web успешны. Полный legacy Web contract-набор — 158/160: остаются
  два прежних несвязанных ожидания `articles root owns list template settings
  and Content is real child navigation` (старый вызов
  `navigateToArticlesSection("content")`) и `site navigation keeps utilities
  visible independently of central content` (старые CSS-ожидания
  `fixed/sticky`).
- Коммит реализации: текущий коммит ветки `codex/access-control-v2`; точный хеш
  хранится в истории Git. Отдельный документационный коммит ради записи
  собственного хеша не создаётся.
- Выкладка: не было. `main`, GitHub, VDS, внешняя БД и внешние сайты не
  изменялись.
- Восстановление: `down()` возвращает колонку `can_edit_code` со значением
  `false`; прежние индивидуальные значения восстановить невозможно. Откат
  приложения сам по себе не откатывает схему. Перед внешним применением нужна
  проверенная резервная копия и проверка миграции на копии БД.

Журнал начат 20.09.2026 для совместной работы Артёма и Романа. Новые записи
добавляются сверху; существующая запись обновляется по ходу задачи. Это описание
изменений для людей и AI, а не замена Git, исполняемых миграций или резервных копий.

## Как вести журнал

Статусы: **В работе → Готово, не выложено → Выложено**; отдельно **Заблокировано**
или **Отменено** с причиной. Для документации допустим статус **Готово, документация**.
В записи всегда разделять изменения кода, схемы, данных и окружения.
«Миграций нет» не означает «данные не меняются»: новый формат JSON или новая
логика записи в существующие таблицы тоже должны быть описаны.

```md
### YYYY-MM-DD · краткое название

- Статус:
- Владелец / задача / ветка:
- Что изменено и зачем:
- Файлы / модули:
- БД — схема: нет / точные миграции, таблицы, поля, индексы.
- БД — данные и формат: нет / затронутые записи, JSON, backfill, ручные операции.
- Совместимость / пересечения с параллельной работой:
- Проверки и оставшиеся ограничения:
- Коммит реализации:
- Выкладка: не было / окружение, дата, точный коммит, применённые миграции.
- Восстановление: совместимость прежнего кода, резервная копия / ограничения отката.
```

### 2026-10-05 · Читабельное оформление актуальной статьи

- Статус: **Выложено**. Артём / Codex. `creation-article.tsx`, `content-center-view.module.css`: цельный семантический article, ширина до 740 px, иерархия заголовков, лид, интервалы, оформление списков и цитат. Убраны разделители между блоками; большие кнопки заменены на компактные AI справа в выделенном поле, с доступными названиями. Панель выделенного фрагмента остаётся над текстом. Обработчики, data-ai-target, содержимое и версии, API/БД не менялись.
- Проверки: ESLint TSX, diff --check, render regression статьи и preview версии; отдельные проверки сохранения целей title/excerpt/block и доступных кнопок. Production build/TypeScript успешны. In-app Browser 1280 × 720: версия `9dc9174`, 10 текстовых целей, кнопки 32 × 32, основной текст 16/28 px, заголовок 28.16 px, границ между блоками нет, пересечений кнопок и текста 0. Кнопка заголовка открывает «Контекст: заголовок» с верным текстом; затем возвращён общий контекст. Генерация и сохранение не запускались. Узкий viewport отдельно не проверялся.
- Выкладка: `9dc9174`, только web, образ `wispo-cms-web:prose-9dc9174` (`168be49ce67b`), API health ok. Откат: `wispo-cms-web:before-prose-9dc9174`, исходники `/opt/wispo-cms-releases/archive-d9d7a16`. Архив кода на ПК: `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/wispo-9dc9174.tar.gz`.

### 2026-10-05 · Архивные темы свёрнуты по умолчанию

- Статус: **Выложено**. Tier 1, Артём / Codex. В `creation-table.tsx` начальное `collapsed.archived` изменено на `true`; активные темы остаются раскрытыми. Заголовок, счётчик и ручное раскрытие архива сохранены; API, сохранение данных, фильтрация и пагинация не менялись.
- Проверки: адресные render-тесты (5 passed), ESLint TSX, diff --check, production build/TypeScript. Обновлены устаревшие названия в затронутом тесте таблицы. Встроенный Browser, свежая вкладка версии `d9d7a16`: архив при загрузке `aria-expanded=false`, архивной строки нет; нажатие показывает строку, повторное скрывает. Оставлено свёрнутым, данные не менялись.
- Код `d9d7a16`, образ `wispo-cms-web:archive-d9d7a16` (`c1b9341d87be`), обновлён только web, API health `ok`. Откат: `wispo-cms-web:before-archive-d9d7a16`, предыдущие исходники `/opt/wispo-cms-releases/hints-444a6ee`. Архив исходников на ПК: `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/wispo-d9d7a16.tar.gz`.

### 2026-10-04 · Убраны вводные подсказки над таблицей тем

- Статус: **Выложено**. Tier 0, Артём / Codex. По просьбе пользователя удалены два абзаца («Каждая строка…», «Отметьте нужные строки…») вместе с обёрткой из `creation-table.tsx`. Остальные подсказки, кнопки, обработчики, API и данные не менялись.
- Проверки: ESLint файла, `git diff --check`, production build/TypeScript. В новой вкладке встроенного Browser подтверждена версия `444a6ee`: обоих текстов и блока `topicIntro` нет, таблица с двумя темами и кнопки добавления/подготовки на месте. Старая вкладка не обновилась (навигация ERR_ABORTED), поэтому для проверки открыта свежая вкладка; она оставлена пользователю.
- Код `444a6ee`, web-образ `wispo-cms-web:hints-444a6ee` (`7eacc74553f4`), API health `ok`; обновлён только web. Откат: `wispo-cms-web:before-hints-444a6ee` и предыдущий файл из `/opt/wispo-cms-releases/editor-187c1c5`. Архив исходников: `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/wispo-444a6ee.tar.gz`.

### 2026-10-04 · Оформление добавления и редактирования темы

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Только окно кластера: отступы, отдельная шапка и нижняя панель, прокручиваемое тело, компактная адаптивная сетка запросов и кнопка удаления. Валидация, сохранение, API, данные и миграции не менялись.
- Файлы: `creation-view.tsx`, `content-center-view.module.css`. ESLint затронутого TSX, `git diff --check`, production build и TypeScript пройдены.
- In-app Browser на боевом сайте, окно 333 × 1052: внутренние отступы 16 px, radio 18 × 18 px; диалог помещается в окне. Добавление второго запроса включает прокрутку тела (760 / 927 px), нижняя панель остаётся видимой. Удаление второго запроса возвращает одну строку и блокирует удаление последней. Отмена закрывает форму, в таблице остаются прежние две темы; тестовые данные не сохранялись. Пустая форма снова открыта для пользователя. Широкий viewport отдельно не проверялся.
- Выкладка: код `187c1c5`, образ `wispo-cms-web:editor-187c1c5` (`084bc68ea7d2`); обновлён только web, API health `ok`. Перед копированием оба live-файла совпали с предыдущим release `topics-88325b0`.
- Откат: `wispo-cms-web:before-editor-187c1c5` и исходники `/opt/wispo-cms-releases/topics-88325b0`. Предыдущий архив сохранён и проверен на ПК: `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/wispo-88325b0.tar.gz`, SHA256 `c64b94ce08a36b48258df7b0a192975c4bc4af463b173aab437f7647b4b3d6b2`.

### 2026-10-04 · Понятный выбор тем перед подготовкой

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Tier 1, только таблица создания контента: убрать отдельное «выбрать все», объяснить тему/кластер и добавление темы, подсветить выбранные строки, показать названия выбранных тем с подготовкой после таблицы. API, данные, права и миграции не меняются.
- Файлы: `creation-table.tsx`, `content-center-view.module.css`, адресный render-тест. ESLint, diff --check, focused render regression (пустой выбор, названия, архив, скрытые фильтром темы), production build/TypeScript пройдены. Browser: выбор строки → название в итоговом блоке → окно с той же темой, версией 9 и площадкой → отмена → удаление из выбора и блокировка подготовки. Затем пример снова выбран для пользователя. AI не запускался, данные не менялись; ширина документа 318 при окне 333 px.
- Выкладка 04.10.2026: `88325b0`, web image `wispo-cms-web:topics-88325b0` (`8d0a77fcb4ad`), API health ok. Откат: `wispo-cms-web:before-topics-88325b0`, исходники `select-8e745a0`, архив `wispo-8e745a0.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` с совпавшей SHA256.

### 2026-10-04 · Отступы стрелок фильтров

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Tier 0: три select-фильтра таблицы, единый отступ стрелки справа и резерв под неё. Нативные select и их обработчики сохраняются; БД, данные, API и миграции не меняются.
- Файл: `content-center-view.module.css`. Diff --check, production build/TypeScript пройдены. Browser подтвердил у всех трёх фильтров padding-right 42px, стрелку 16×16 с отступом 14px и центровкой по высоте; существующая SVG возвращает HTTP 200. Для forced-colors сохранена нативная стрелка.
- Выкладка 04.10.2026: `8e745a0`, web image `wispo-cms-web:select-8e745a0` (`1d99550315b8`), API health ok. Откат: `wispo-cms-web:before-select-8e745a0`, исходники `dialog-1f39f2d`, архив `wispo-1f39f2d.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` с совпавшей SHA256.

### 2026-10-04 · Оформление окна подготовки статей

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Ограниченная UI-правка окна запуска: внутренние отступы, прокручиваемая середина, отдельные header/footer, компактные сведения и единый заголовок пожеланий. API запуска, данные, права и миграции без изменений.
- Файлы: `creation-launcher.tsx`, `creation-shared.tsx`, `content-center-view.module.css`; опциональное компактное оформление не меняет остальные диалоги и редактор статьи. ESLint, адресный render-тест, diff --check и production build/TypeScript пройдены.
- Browser на узком окне 333×1052: диалог fixed, границы y=76..976 полностью на экране; внутренние отступы 16 px, textarea 112 px, единственный видимый заголовок пожеланий. Проверены ввод/очистка, внутренняя прокрутка, возврат к темам и повторное открытие. AI и публикация не запускались. Широкая двухколоночная раскладка задана CSS; отдельная широкая Browser-проверка не проводилась.
- Выкладка 04.10.2026: `ce0b1c6`, затем исправление позиции `1f39f2d`; финальный web image `wispo-cms-web:dialog-1f39f2d` (`c17e7eecbf3d`), API health ok. Откат к прежнему оформлению: `wispo-cms-web:before-dialog-ce0b1c6`, исходники `center-d75b642`; архив `wispo-d75b642.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` с совпавшей SHA256.

### 2026-10-04 · Вертикальный центр содержимого строк

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Tier 0: только `vertical-align` ячеек таблицы создания контента; ширины и поведение без изменений. БД, данные, API и миграции не затронуты.
- Файл: `content-center-view.module.css`. Diff --check, production build/TypeScript пройдены. Browser: все девять ячеек обеих строк имеют middle; центр кнопки названия совпадает с центром активной строки, вместо прежнего выравнивания по верхнему краю.
- Выкладка 04.10.2026: `d75b642`, web image `wispo-cms-web:center-d75b642` (`934478ab5672`), API health ok. Откат: `wispo-cms-web:before-center-d75b642`, исходники `arrows-05da0a3`; архив `wispo-05da0a3.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` с совпавшей SHA256.

### 2026-10-04 · Выравнивание стрелок групп

- Статус: **Выложено**. Артём / Codex, `feature/creation-publication-stage-7`. Tier 0: центровка стрелок относительно чекбоксов и текста, без изменения раскрытия групп, данных, API, БД или миграций.
- Файлы: `creation-table.tsx`, `content-center-view.module.css`. ESLint, diff --check, production build/TypeScript пройдены. Browser: центры SVG и чекбоксов совпали (x=56), центры SVG по Y совпали с центрами строк. Повторный клик по группам не подтверждён: Browser вернул `No node found at given location`; обработчики раскрытия не менялись.
- Выкладка 04.10.2026: `05da0a3`, web image `wispo-cms-web:arrows-05da0a3` (`f092d3d2e77c`), API health ok. Откат: `wispo-cms-web:before-arrows-05da0a3`, исходники `header-9d7c260`, архив `wispo-9d7c260.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` с совпавшей SHA256.

### 2026-10-04 · Компактная шапка таблицы

- Статус: **Выложено**. Владелец: Артём / Codex, `feature/creation-publication-stage-7`.
- Tier 0: при единственной площадке убрать отдельный верхний заголовок площадки, оставить поля и ширины; при нескольких площадках сохранить группировку. Только представление `creation-table.tsx`, без изменений БД, данных, API, прав и миграций.
- Проверки: ESLint, адресный render-тест для 0/1/2 площадок, diff --check, production build/TypeScript пройдены. Встроенный Browser: одна строка заголовков вместо двух, высота 66.5 вместо 91.5 px; все девять ширин столбцов сохранены, отдельного заголовка Crazy Studio Test нет.
- Выкладка 04.10.2026: `9d7c260`, web image `wispo-cms-web:header-9d7c260` (`0ff0cf3f4304`); API health ok. Откат: image `wispo-cms-web:before-header-9d7c260`, исходники `table-d398a30` и архив `wispo-d398a30.tar.gz` на сервере и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/` (SHA256 совпадает).

### 2026-10-04 · Читаемая таблица создания контента

- Статус: **Выложено**. Владелец: задача Артёма / Codex, `feature/creation-publication-stage-7`.
- Запрос: исправить диспропорции таблицы, узкие статьи, отступы и визуальную иерархию. Tier 0: только представление `creation-table.tsx` и стили `content-center-view.module.css`; поведение выбора, фильтров и запуска не меняется. БД, API, данные, права и миграции не затронуты.
- Реализация: фиксированная раскладка и colgroup вместо автоматического распределения; номер 48 px вместо 260, статья 280 вместо 136, числовые колонки выровнены вправо, текст по верхнему краю. Обновлены отступы, заголовки групп, счётчики, статусы и hover только внутри этой таблицы.
- Проверки: ESLint компонента, diff --check, production build и TypeScript пройдены. Встроенный Browser после выкладки подтвердил ширины 48/280 px и две строки в названиях статей; на ширине окна 333 px документ не растянут (scrollWidth 318), таблица имеет собственную прокрутку. Новые AI-запуски и изменения данных не выполнялись.
- Выкладка: 04.10.2026, коммит `d398a30`, image `wispo-cms-web:table-d398a30` (`78871f7456f7`). Только web, API health ok. Откат: image `wispo-cms-web:before-table-d398a30` и `/opt/wispo-cms-releases/before-table-d398a30.tar.gz`; копия с совпавшей SHA256 сохранена в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/before-table-d398a30.tar.gz`.

### 2026-10-04 · Явный выбор тем и окно подготовки статей

- Статус: **Выложено**. Владелец: задача Артёма / Codex, `feature/creation-publication-stage-7`.
- Запрос: убрать инструкцию с первого экрана; сначала выбрать темы, затем проверить основу и площадки, написать пожелания и запустить. Пустой выбор больше не означает все темы в UI; выбор всех — явная кнопка.
- Область: web создания контента, существующие read-only данные подготовки. Контракты генерации, права, БД и миграции не меняются. Новая AI-генерация при проверке не требуется.
- Реализация: сначала таблица, кнопки явного выбора всех и подготовки. В окне — выбранные темы, последняя подготовленная версия с ссылкой на документ, площадки, затем пожелания. Метаданные перечитываются перед подтверждением; изменение состава требует повторной проверки пользователем. Выбор нескольких исходных версий и AI-обработчик не изменены. Неподдерживаемое прикрепление файла в новом окне отключено с объяснением.
- Проверки: 22 адресных web-теста и отдельно новая регрессия выбора тем пройдены (23 проверки); lint изменённых компонентов, TypeScript и production build пройдены. Встроенный Browser на VDS: без выбора запуск отключён; явный выбор всех включает только актуальную тему; окно показывает выбранную тему, подготовленную версию 9 и Crazy Studio Test. Возврат к темам сохраняет пожелания. Новая AI-генерация и публикация намеренно не запускались; стабильность AI этим UI-изменением не исправлялась.
- Коммиты реализации: `13b973c`, исправление сборки `119bfb5`. Выкладка 04.10.2026: VDS заказчика, web image `wispo-cms-web:launch-119bfb5` (`7eb1b836b4ab`), контейнер running, API health ok. API и БД не менялись.
- Восстановление: прежний web image `wispo-cms-web:before-launch-dialog-20261004`; исходники `/opt/wispo-cms-releases/before-launch-dialog-20261004.tar.gz`. Независимая копия с проверенной SHA256: `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/before-launch-dialog-20261004.tar.gz`.

### 2026-10-04 · Контрольная сверка ТЗ и выравнивание создания контента

- Статус: **Выложено**. Владелец: задача Артёма / Codex.
- Запрос: контрольная сверка с Notion-ТЗ и исправление наложения процента/текста на скриншоте. Tier 0 для визуальной правки; функциональные расхождения только фиксируются, без изменения контрактов.
- Причина наложения: один CSS-класс `runProgressBar` использовался для контейнера создания контента и нативного progress подготовки; позднее правило задавало контейнеру display:block и высоту 6px. Разделяем классы, процент получает отдельную колонку, высота строки определяется содержимым.
- Файлы: `creation-progress.tsx`, `content-center-view.module.css`. БД, API, права, данные и миграции не меняются.
- Проверки: ESLint изменённого компонента, git diff --check, production build и TypeScript пройдены. Во встроенном Browser проверены таблица, карточка кластера/статьи, три раздела истории, данные публикации, три версии, список промптов и настройки площадок. Новые AI-запуски, публикации и изменения данных не выполнялись.
- Browser после выкладки: ширина 333 и 1564 px; процент в отдельной колонке, высота контейнера 21.69 px вместо 6 px, нижняя граница процента на 8 px выше следующего текста. Ширина документа не превышает окно. Исправление относится и к прогрессу внутри карточки статьи.
- Выкладка: код `61fb4de`; web image `7affc386a81f`, контейнер healthy, HTTP 200, API health ok. Перезапущен только web. Предыдущий образ сохранён как `wispo-cms-web:before-progress-20261004`. Архив исходных двух файлов и архив релиза сохранены на VDS и в `E:/backups/Wispo-CMS-archive-20260924/customer/releases/20261001-access-control/`; SHA256 совпадают.

#### Контрольная сверка «Создания контента» с Notion-ТЗ от 18.09.2026

Источник: https://wispo-agency.notion.site/3d99523e994e80a6964ac056e8f2d360 (прочитан полностью 04.10.2026). Это контрольная сверка, а не новый полный E2E: для изменяющих данные сценариев использованы результаты реальной проверки 02.10 и существующие тесты; сегодня проверялись код и доступные экраны без записи данных. Раздел нельзя объявлять полностью закрытым по ТЗ.

| Раздел ТЗ | Результат и границы проверки |
| --- | --- |
| 2.1–2.5: таблица, активные/архивные кластеры, выбор, запуск | Реализованы; фильтры и архив видны в Browser. По коду пустой выбор означает все активные, исключаются снятые статьи и незавершённые предложения. Запуск/генерация подтверждены E2E 02.10. |
| 2.6: инструкция, промпты, файл | Частично: инструкция и выбор общего промпта есть. Вложения не работают с текущим AI: `DeepseekService.supportsFiles=false`, backend отклоняет запрос с файлом, хотя UI разрешает прикрепить его. В локальном диалоге нет предусмотренного ТЗ добавления промпта — редактирование общей библиотеки вынесено в настройки. |
| 2.7: автоматический контекст | Частично: подготовленная информация, кластер, существующий контент и правила передаются; `researchResults: []` — результаты исследований не подключены. Выборка существующего контента ограничена 500 CMS-статьями и 500 черновиками без сообщения об отсечении более старых записей. При >2 млн символов существующего контента запуск блокируется; это не многоступенчатая обработка всего архива. |
| 2.8–2.12: правила, прогресс, статусы, рекомендации, переходы | Основная реализация присутствует. Прогресс исправлен и проверен после выкладки; настройки проекта/площадок доступны. Повтор сбоя сегодня не инициировался, код retry присутствует. |
| 3: история запусков, кластеров, статей | Все три вкладки и фильтры доступны. У публикации раскрываются версия, площадка и URL. Общая история не заменяет историю версий. Новые split/merge сегодня не выполнялись. |
| 4: карточка кластера | Запросы, основной запрос, частотности и связанная статья отображаются. В ветке отсутствующей статьи нет явной рекомендации «Создать», требуемой п.4.5; показан только текст о будущем определении релевантности. |
| 5–6: статья, корректировки, публикация, версии | Основной текстовый цикл подтверждён E2E 02.10: принятие/отклонение предложений, новые версии, независимая публикация, восстановление, снятие с публикации с HTTP 404. Сегодня открыты статья и сохранённые версии. Вложения в корректировку имеют тот же блокер, что и генерация. |

Дополнительные ограничения/расхождения макета:
- Площадки в текущем MVP — только сайты данного workspace (`siteId`), что явно указано и в UI. Дзен и другие внешние площадки не интегрированы; считать их выполненными по общему макету нельзя.
- Кнопка экспорта из иллюстрации отсутствует в таблице. В текстовых требованиях экспорт не описан: нужен согласованный формат, а не автоматическое расширение объёма этой правки.
- Старые документы `content-center-creation-mvp.md` и `content-center-creation-closeout.md` содержат статусы до подключения AI. Для фактического состояния использовать запись 02.10 и эту сверку; документацию нужно актуализировать отдельным проходом.

Приоритет оставшейся работы: (1) вложения генерации/корректировок; (2) подключение результатов исследований и явная стратегия большого контекста; (3) согласовать внешние площадки и создание промптов в этом экране; (4) мелкие расхождения карточек/экспорта и актуализация документации. Функциональные контракты в рамках текущей косметической выкладки не менялись.

### 2026-10-02 · Создание контента — этап 7, публикация и сквозная проверка

- Статус: **Выложено**, сквозная проверка завершена 02.10.2026 03:44 МСК. Владелец: задача Артёма / Codex; ветка `feature/creation-publication-stage-7`.
- Область: форма публикации, явные причины недоступности и проверка цепочки кластер → статья → корректировка → версия → публикация. Tier 2: сценарий публикации и защита пользовательских данных.
- БД — схема: изменений и миграций нет. Пользователь отдельно разрешил полный живой цикл в Crazy Studio Test с последующим снятием публикации; тестовый кластер и история остаются. Другие материалы и права сотрудников не меняются.
- Файлы: форма в `creation-article.tsx`, отдельный компонент публикации и адресные web/API тесты. Серверный контракт сохраняется, если проверка не выявит конкретный дефект.
- Дополнительно выявлен реальный сбой DeepSeek JSON на запуске №1. В `deepseek.service.ts` для статей включено сохранение буквальных LF/CR/TAB через безопасное экранирование и один повтор только при ошибке формата; структура статьи/предложений и exact-before остаются строгими, текстовый fallback для статей запрещён. В этой поставке обновляются web и API.
- Проверки: 16 web-тестов и TypeScript/ESLint прошли. 16 интеграционных сценариев с настоящей изолированной PostgreSQL и подставным AI прошли (15 в полном запуске, один после исправления устаревшего тестового repository — отдельно). Фикстуры переведены с workspace_memberships на site_accesses; продуктовые права не менялись. 35 тестов DeepSeek прошли (34 в общем запуске, один после исправления mock Response — отдельно). Ошибки начальных запусков были в старых тестовых фикстурах и сетевом лимите времени; для PostgreSQL через SSH использован testTimeout=60000.
- Живой тест: запуск №2 с реальным DeepSeek создал V1; публичная страница проверена. Две AI-правки рассмотрены отдельно: первая принята без изменения V1, вторая отклонена — создана V2 только с принятой правкой. Публикация V2 сохранила URL. Восстановление V1 создало V3, публичная V2 не изменилась. Созданы только тестовый кластер, статья `eb844c57-9415-40e3-97f4-0b3764df0036` и рубрика `7c3c46c4-0fb0-4676-831f-5a8576aedacd` в Crazy Studio Test.
- Дополнительный дефект сквозной проверки: снятие публикации записывало `hidden`, что по контракту CMS сохраняет доступ по прямому URL. В `a4007cf` адаптер контент-центра исправлен на `disabled`, включая снятие старой страницы при переносе; общая семантика `hidden` не меняется. Проверены 17 тестов публичного жизненного цикла и два адресных PostgreSQL-сценария (версии/снятие и перенос). Для переноса исправлено устаревшее ожидание hidden и выполнен отдельный зелёный повтор. ESLint изменённых API-файлов прошёл.
- Финальный Browser: после обновления API V3 повторно опубликована по прежнему адресу `/preview/crazy-studio-test/articles/cms-e2e-test-20261002` и снята. Публичный API возвращает 404, встроенный браузер показывает «Материал не найден или ещё не опубликован». Кластер архивирован; статья и V1–V3 сохранены без опубликованной версии. Пустая явно тестовая рубрика остаётся в Crazy Studio Test для дальнейших проверок; чужие сайты не изменялись. Временные публичные вкладки закрыты, размер браузера возвращён к исходному, пользовательская вкладка оставлена на истории версий.
- Перед живыми изменениями БД/медиа сохранены `wispo-20261001T231513Z.sql.gz` и `wispo-media-20261001T231513Z.tar.gz` на VDS и в `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control`. SHA-256 соответственно `80f0764de043ef605ea032f47639a50dc13f7247efe22775ee3c9b0c83ce4bca` и `35ce101d98c5da52184ada03d71c53966d261908e1be07ba14eb6cfb83516ed1` совпадают.
- Выкладка: `c6875cd` установлен 02.10.2026 02:26 МСК. API-образ `556e56fc66e1`, web-образ `c8614aa9aada`; обе production-сборки прошли. Исходники web/API на VDS дважды совпали с базой `ae8f35b`. Узкое исправление `a4007cf` установлено 02.10.2026 03:43 МСК только в API, образ `7cb1c82ac830`, production-сборка прошла; перед заменой live API совпал с `c6875cd`. Применённых миграций до и после 48, новых миграций/изменений data-source нет. API/web/PostgreSQL healthy; при втором релизе web и PostgreSQL не перезапускались.
- Дополнительный бэкап перед исправлением снятия: `wispo-before-a4007cf.sql.gz` на VDS и в том же каталоге E; SHA-256 обеих копий `0fcb6bc123ec044e925e81b14b764847467036d660877f13e495d4d369c7b46d`. Изолированный контейнер `wispo-stage7-unpublish-tests` и его тестовый том удалены, туннель закрыт. Автоматического backfill старых hidden-статей не выполнялось: тестовая запись исправлена штатной повторной публикацией/снятием.
- Откат: теги `wispo-cms-api:pre-stage7-c6875cd`, `wispo-cms-web:pre-stage7-c6875cd`; архив `code-before-stage7-c6875cd.tar.gz` на VDS и в указанном каталоге диска E, SHA-256 `26a12969ea9c921eca787c60f833ffd42fedd9d9e59bff36b7688ee48fcac703`. Изолированный контейнер `wispo-stage7-tests` с тестовым томом удалён после проверок, SSH-туннель закрыт.

### 2026-10-02 · Создание контента — этап 6, статья и версии

- Статус: **Выложено** 02.10.2026 02:05 МСК. Владелец: задача Артёма / Codex; ветка `feature/creation-article-stage-6`.
- Область: читаемая карточка статьи, отдельная панель предложений AI и просмотр версий с явными состояниями загрузки. Tier 1: существующие API принятия/отклонения, восстановления и публикации сохраняются.
- Файлы: `creation-article.tsx`, связанные компоненты/стили и адресные web-тесты.
- БД — схема/данные/формат: изменений и миграций нет; тестовые записи в рабочей базе не создаются.
- Приёмка: текущая и опубликованная версии различаются, предложения показывают «было/стало» и решения, переключение версии не показывает старый снимок как новый. Проверки: адресные тесты, TypeScript/ESLint, production web-сборка и доступный сценарий во встроенном Browser.
- Реализация: текст статьи первым в DOM и в левой колонке, корректировка и предложения справа; на узком экране одна колонка. Счётчики решений, отдельные кнопки каждого предложения; контракт принятия/отклонения не меняется. Версии отсортированы, выбранная отмечена, снимок привязан к ID/номеру/revision с защитой от позднего ответа, ошибкой и повторной загрузкой. Показывается описание версии, пустой diff не называется первой версией. Площадка определяется по site_id, публичная ссылка только безопасная HTTP(S)/CMS-relative и только для опубликованной статьи.
- Проверки до релиза: 15 адресных web-тестов, TypeScript, ESLint изменённого компонента и diff-check прошли. Изменения API, разрешений, публикации и восстановления отсутствуют.
- Выкладка: коммит `9d1f88d`, web-образ `wispo-cms-web:stage6-9d1f88d`, ID `3487c886dad4`. Production-сборка (Next.js/TypeScript) прошла. Исходники live web дважды сравнены с базой `30af227`, сторонних изменений нет. Обновлён только web через оба Compose-файла с `--no-deps --no-build`; API и PostgreSQL не перезапускались. Все три контейнера healthy, API `ok`, сайт HTTP 200.
- Browser: существующая сессия администратора во встроенном браузере загрузила контент-центр после reload и перешла в историю. Выбранный проект не содержит кластеров/статей: заполненная статья, предложения и просмотр версий проверены адресными тестами, не на рабочей БД. AI, восстановление и публикация на production не запускались; это остаётся для сквозного этапа 7.
- Откат: образ `wispo-cms-web:pre-stage6-9d1f88d`; архив `/root/wispo-cms-backups/web-before-stage6-9d1f88d.tar.gz` и копия `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control\web-before-stage6-9d1f88d.tar.gz`. SHA-256 обеих копий `9336c1248844b9e2064671dcd8d7b02d818434030dacb75a37a6b73a101054f3`. Прежний образ совместим с БД.

### 2026-10-02 · Создание контента — этап 5, карточка кластера

- Статус: **Выложено** 02.10.2026 01:54 МСК. Владелец: задача Артёма / Codex; ветка `feature/creation-cluster-stage-5`.
- Область: карточка кластера, сводка частотностей, запросы, статьи по площадкам, отдельные статусы и рекомендации, переходы к версиям и истории. Tier 1: существующие обработчики редактирования/разделения и API сохраняются.
- Файлы: новый `creation-cluster.tsx`, `creation-view.tsx`, стили и адресные тесты.
- БД — схема/данные/формат: изменений и миграций нет. Архивные кластеры не участвуют в запуске, статьи отключённых площадок остаются видимыми. Рабочие данные не наполняются тестовыми записями.
- Проверка: 13 адресных тестов прошли, включая рендер активного/архивного кластера, несколько площадок и отключённую площадку, версии и безопасные ссылки. TypeScript, адресный ESLint, diff-check и production-сборка web прошли.
- Коммит реализации: `4eee681`. Образ `wispo-cms-web:stage5-4eee681`, ID `c8e08ea6ccef`. Перед выкладкой исходники web на VDS дважды сравнены с базой `e877c44`: отличий нет; удалённый main не содержит новых параллельных коммитов. Обновлён только web через оба Compose-файла с `--no-deps --no-build`.
- После выкладки: web/API/PostgreSQL healthy, API `ok`, публичная страница HTTP 200; API и БД сохранили прежний uptime. Встроенный Browser в существующей сессии администратора загрузил контент-центр, открыл форму «Новый кластер» и закрыл её через «Отмена» без сохранения.
- Ограничение Browser-проверки: выбранный проект пока без кластеров; заполненная новая карточка проверена рендер-тестами, а не на рабочих данных. AI, публикация и запись тестовых данных не запускались.
- Откат: образ `wispo-cms-web:pre-stage5-4eee681`; архив `/root/wispo-cms-backups/web-before-stage5-4eee681.tar.gz` и копия `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control\web-before-stage5-4eee681.tar.gz`. SHA-256 обеих копий: `04d79b6ba2af60e20c71b5f4ae12bc7c189779da3cd792c1cb22a2f1ed953d0b`. Миграций нет, предыдущий образ совместим с БД.

### 2026-10-02 · Общая выкладка этапов 2–4 создания контента

- Статус: **Выложено** 02.10.2026 01:41 МСК. Доступ к VDS восстановился; повторная проверка SSH, HTTP 200 и трёх healthy-контейнеров успешна. Встроенный Browser открыл CMS в существующей сессии администратора.
- Коммит кода: `ee2667d`, ветка `feature/creation-launcher-stage-2` (включает `fa7bb95`, `01b3798`). Содержимое `apps/web/src` на VDS сравнено с базой `2e64c41` через `diff --strip-trailing-cr`: отличий нет. Удалённый main не содержит новых параллельных коммитов.
- Окружение: обновляется только web; API, БД, миграции и клиентские записи не меняются.
- Откат: прежний образ `wispo-cms-web:pre-stage234-ee2667d`; архив `/root/wispo-cms-backups/web-before-stage234-ee2667d.tar.gz` скопирован на `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control\web-before-stage234-ee2667d.tar.gz`. SHA-256 обеих копий: `1a9b1c4fe74e580da960ad7243c552bb4b368c1ef9eed94f423976dabc6fff5d`.
- Production-сборка web прошла (Next.js + TypeScript); образ `wispo-cms-web:stage234-ee2667d`, ID `a967ed8c06b4`. Обновлён только web через оба Compose-файла с `--no-deps --no-build`; API и PostgreSQL сохранили прежний uptime. После выкладки три контейнера healthy, API `ok`, сайт HTTP 200.
- Встроенный Browser: выбран существующий промпт «Структура статьи» (2979 символов перенесены в поле), инструкция отредактирована и очищена; тестовый локальный файл прикреплён и удалён без отправки на сервер/AI. Переход «Все запуски», все три вкладки, сортировка по дате, фильтры, их независимость по вкладкам, сброс и размер страницы проверены. На узком экране 334 px и на 1440 px переполнения документа нет. Ошибок браузерной консоли нет, viewport возвращён к исходному. Скриншот сохранён в `.codex-output/wispo-stage234-deployed.png` вне репозитория.
- Ограничение проверки: в выбранном проекте нет кластеров/запусков; заполненные таблицы и состояния прогресса проверены адресными тестами, а не искусственными записями в рабочей БД. AI, публикация и микрофон не запускались. Разрешения пользователей не менялись.

### 2026-10-02 · Создание контента — этап 4, полная история

- Статус: **Выложено** 02.10.2026 в общем релизе этапов 2–4 выше. Владелец: задача Артёма / Codex; ветка `feature/creation-launcher-stage-2`.
- Область: вкладки истории, поиск/даты/пользователь/тип события, сортировка по дате, пагинация и раскрытие изменений на полную ширину таблицы. Tier 1, существующий read-only API.
- Файлы: `creation-history.tsx`, `creation-history-state.ts`, стили и адресные web-тесты.
- БД — схема/данные/формат: изменений и миграций нет; используются сохранённые снимки событий, без пересчёта старой истории по актуальным кластерам.
- Поведение: фильтры сохраняются раздельно по вкладкам; смена условий/сортировки/размера страницы возвращает на первую страницу, уменьшение данных ограничивает текущую страницу. Диапазон дат включает весь конечный день и проверяет обратный порядок. Поиск обрезает внешние пробелы. В контекст кластера входят также связанные события разделения/объединения. Раскрытые снимки занимают всю ширину таблицы; для запусков раскрытия нет. Существующая загрузка полной истории через API сохранена, пагинация клиентская.
- Проверки: 12 адресных тестов прошли, включая фильтры/границы дат/сортировку/пагинацию/контекст связанных кластеров/разметку раскрытия, безопасные ссылки публикаций и соседние компоненты. TypeScript, адресный ESLint и `git diff --check` прошли. Production-сборка и визуальная проверка не выполнялись; остаются обязательными перед выкладкой после восстановления доступа к VDS. Повторных запросов к недоступному серверу на этом этапе не делалось.
- Выкладка: не выполнялась. API, миграции, рабочая БД и файлы сервера не менялись; `main` не обновлялся. Этапы 2–4 готовы к общей web-сборке и проверке после восстановления доступа.

### 2026-10-02 · Создание контента — этап 3, прогресс и последние запуски

- Статус: **Выложено** 02.10.2026 в общем релизе этапов 2–4 выше. Владелец: задача Артёма / Codex; ветка `feature/creation-launcher-stage-2`.
- Область: прогресс по реально завершённым операциям, состояния очереди/обработки/завершения, детали по кластерам и последние запуски со ссылкой на историю. Оценку оставшегося времени не выдумывать. Tier 1: отображение существующих API-данных.
- Файлы: `creation-progress.tsx`, `creation-progress-state.ts`, `creation-view.tsx`, стили и адресные web-тесты.
- БД — схема/данные/формат: изменений нет, миграций нет. AI-запуски и записи в рабочую БД для проверки не выполняются.
- Поведение: процент считается по завершившимся операциям (успешные + ошибочные + пропущенные), с отдельными счётчиками исходов; до финального статуса не показывает 100%. Детали сгруппированы по кластеру и площадке, сворачиваются. Последние два production-запуска используют существующий `/history`; запрос выполняется при входе и изменении ID/статуса запуска, не на каждом тике прогресса. Количество статей и ETA не выдумываются. Повтор ошибок доступен только для production-запуска; контракт повтора не меняется.
- Проверки: 18 адресных тестов прошли, включая queued/processing/succeeded/partial/failed, пустое состояние, объединение текущего статуса с историей и соседние сценарии этапов 1/2. После исправления загрузочного состояния повторены 9 затронутых рендер-тестов — зелёные; финальные TypeScript/ESLint прошли. Production-сборка и визуальная проверка ещё не выполнены: повторная проверка SSH/HTTPS 02.10.2026 снова дала тайм-аут, загрузка страницы во встроенном Browser тоже завершилась тайм-аутом.
- Выкладка: не выполнялась, БД и файлы VDS не менялись. Перед выпуском этапов 2/3 требуется восстановить доступность, проверить параллельные изменения на сервере, собрать web, выполнить браузерный сценарий; API и миграции для этих этапов не нужны. Исходный код этапа 2 сохранён коммитом `fa7bb95`.

### 2026-10-02 · Создание контента — этап 2, блок запуска

- Статус: **Выложено** 02.10.2026 в общем релизе этапов 2–4 выше. Владелец: задача Артёма / Codex; ветка `feature/creation-launcher-stage-2`. Прежний сетевой блокер снят.
- Область: блок запуска перед таблицей, инструкция, выбор существующего промпта, прикрепление/удаление файла и голосовой ввод. Tier 1: существующий контракт запуска сохраняется.
- Файлы: новый `creation-launcher.tsx`, `creation-view.tsx`, `creation-shared.tsx`, необязательный компактный режим `speech-input.tsx`, стили контент-центра и адресные web-тесты.
- БД — схема/данные/формат: изменений и миграций нет; тестовые запуски на данных заказчика не выполняются. Глобальная библиотека промптов и права её редактирования не меняются.
- Проверки: 14 адресных web-тестов прошли, включая рендер блока запуска, выбранный файл, область запуска и причины блокировки; TypeScript и ESLint четырёх изменённых TSX-файлов прошли. Серверные контракты и подтверждение запуска не менялись. Общая библиотека промптов переиспользуется без изменения прав.
- Оставшая проверка: production-сборка и живой сценарий во встроенном Browser (промпт → инструкция → файл → удаление/отмена без AI-запуска). 02.10.2026 SSH к `129.101.122.78:22` дважды завершился тайм-аутом; HTTPS также завершился connect timeout. Попытка открыть страницу во встроенном Browser завершилась тайм-аутом, визуальная проверка не выполнена. Это не доказательство остановки VDS: требуется восстановить/проверить сетевую доступность.
- Выкладка: не выполнялась; сервер, его БД и файлы не менялись. После восстановления доступа сравнить изменяемые исходники с базой `2e64c41`, сохранить текущий web-образ/исходники, собрать и обновить только web с двумя Compose-файлами. До выкладки не вливать этот этап в `main`.

### 2026-10-01 · Создание контента — этап 1, таблица

- Статус: **Выложено** 02.10.2026 (МСК). Владелец: задача Артёма / Codex; ветка `feature/creation-table-stage-1`.
- Область: таблица кластеров, группировка актуальных/архивных, колонки площадок, фильтры и пагинация, адаптация 1440 px. Уровень риска: Tier 1, интерфейс без изменения API.
- Файлы: `creation-view.tsx`, новый `creation-table.tsx`, `creation-table-state.ts`, стили контент-центра и адресные проверки.
- БД — схема/данные/формат: изменений и миграций нет. Рабочие кластеры и статьи тестовыми данными не заполняются.
- Проверка: 13 адресных тестов прошли (пагинация, выбор между страницами, фильтры, рендер с двумя площадками и архивом, соседние сценарии статей/истории). Web TypeScript, адресный ESLint и production-сборка web прошли. Существующие статьи отключённых площадок остаются видимыми. Во встроенном Browser проверены пустое состояние, поиск, выбор размера страницы и открытие/отмена добавления кластера без записи данных. Финальный экран проверен при ширине 1440 px: горизонтального переполнения документа нет, пагинация горизонтальная, поля с рамками. Заполненная таблица проверена серверным рендером тестовых fixtures, не на данных заказчика: в текущем проекте кластеров пока нет.
- Совместимость: раскладка создания контента и стили таблицы изолированы от общих стилей навигации, форм и таблиц; существующий блок запуска сохранён для следующего этапа. Предыдущие файлы на VDS сравнены с базовой версией перед заменой.
- Коммит реализации: `b7eadb3` (включает `561d739` и `97ca865`).
- Выкладка: `https://wispo-cms.129.101.122.78.nip.io/`, 02.10.2026 00:25 МСК, только web; образ `wispo-cms-web:table-stage1-final`. API и БД не перезапускались, миграции не запускались (реестр остаётся 48). Финальная проверка: все три контейнера healthy, API — `ok`, публичная страница — HTTP 200.
- Восстановление: прежний web-образ сохранён как `wispo-cms-web:pre-table-561d739`; исходники — `/root/wispo-cms-backups/web-before-table-97ca865.tar.gz` и `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control\web-before-table-97ca865.tar.gz`. SHA-256 обеих копий совпал: `c93b48e29fb27ee48aaee41e1d647971a85d677903839b2b3ac3b63762499b11`. Изменений данных нет, откат web не требует отката БД.

### 2026-10-01 · Интеграция обновления прав и меню Романа

- Статус: **Выложено** 01.10.2026 на VDS заказчика.
- Владелец / задача / ветка: задача Артёма / Codex, `integration/roman-access-control-20261001`.
- Что изменено и зачем: безопасно объединены `codex/access-control-v2`, актуальный `main` и рабочая ветка `docs/deepseek-text-release` с кодом, уже размещённым на VDS заказчика; контент-центр и текущие данные сохранены.
- Файлы / модули: изменение ветки Романа в API/web, две новые миграции и этот журнал.
- БД — схема: применены `1791523200000-SiteAccessAssignments` и `1791613200000-AdminPasswordEmailConfirmation`, реестр 46→48. Переход предварительно проверен на отдельной копии актуальной БД; тестовая БД после релиза удалена.
- БД — данные и формат: первая миграция переносит существующие назначения сайтов в `site_accesses`; пользовательские роли и данные не менять вручную без отдельного решения.
- Совместимость / пересечения: почта на VDS отключена; пользователь подтвердил сохранение смены пароля администратора по текущему паролю и перенос email-подтверждения до настройки SMTP. Email-восстановление не объявлять рабочим. Ветка контент-центра отличается от `main` на 16 коммитов и содержит код, уже выложенный на VDS; она включена отдельным merge, журналы обеих сторон сохранены. Ещё не выложенный сбор Ozon (`6b349e8`) исключён из этого релиза обратным коммитом; исходная ветка и его код сохранены.
- Проверки и оставшиеся ограничения: первое слияние без конфликтов; при добавлении рабочей ветки контент-центра единственный конфликт был в журнале и разрешён сохранением обеих записей. Сборки API/web и web TypeScript прошли; полный API Jest: 706 passed, 70 skipped, адресные web-тесты: 41 passed. Production API TypeScript через `nest build` прошёл; отдельный `tsc --noEmit` для всего API показывает ошибки старых/test-only файлов, поэтому его зелёным не считаем. Встроенный Browser под существующим администратором после релиза проверил список проектов, контент-центр с сохранёнными материалами и версиями, меню сайта, «Команду и доступы», редактор пользователя и форму смены пароля по текущему паролю; права пользователей не менялись. Ручной вход под владельцем/контент-менеджером не выполнялся. Email-сброс остаётся недоступен до SMTP.
- Коммит реализации: `dfaea44` (слияние веток, сохранение смены пароля без SMTP, исключение ещё не готового сбора Ozon).
- Выкладка: `https://wispo-cms.129.101.122.78.nip.io/`, VDS заказчика, 01.10.2026; API, web и PostgreSQL healthy, `/api/health` — `ok`, публичная страница — HTTP 200, миграций 48. Рабочие данные: 3 пользователя, 4 сайта, 9 версий подготовки, 2 назначения сайтов. Двум legacy-сотрудникам права вручную не менялись.
- Восстановление: финальные архивы БД `wispo-20261001T180039Z.sql.gz` и медиа `wispo-media-20261001T180039Z.tar.gz` проверены по SHA-256 на VDS и скопированы в `E:\backups\Wispo-CMS-archive-20260924\customer\releases\20261001-access-control`; хеши копий совпали. Там же архив кода `wispo-code-dfaea44.tar`. На VDS сохранены прежний каталог `/opt/wispo-cms-releases/pre-access-20261001` и образы `wispo-cms-api:pre-access-20261001`, `wispo-cms-web:pre-access-20261001`. Откат БД разрушительной миграцией запрещён.

Коммит реализации указывается после его создания, например отдельным
документационным дополнением. Для самой записи/документационных правил достаточно
истории Git: не создавать бесконечные коммиты ради записи собственного хеша.
Секреты, строки подключения и содержимое клиентских материалов не включать.

### 2026-10-01 · Итоговая передача этапа прав доступа и навигации

- Статус: **Готово, не выложено**. Все перечисленные ниже локальные доработки
  этапа включены в текущий коммит ветки `codex/access-control-v2`.
- В коммит входят новая модель из трёх ролей, назначения и дополнительные права
  по сайтам, серверные ограничения, согласование и версионность контента и
  CMS-кода, централизованное управление пользователями, защищённая смена пароля
  администратора, а также переработанные меню, навигация и интерфейс раздела
  «Команда и доступы».
- Для БД добавлены две аддитивные миграции: назначения пользователей на сайты и
  одноразовые ссылки подтверждения смены пароля администратора. Локальные dump,
  Docker volumes и тестовые данные в Git не включаются.
- В состав документации входят этот журнал, аудит исходной реализации и план
  переработки с фактическим статусом этапов.
- `main`, VDS и тестовый сервер этим коммитом не изменяются. Выкладка и запуск
  миграций на любом внешнем окружении выполняются отдельно после проверки.
- Коммит реализации: текущий коммит ветки `codex/access-control-v2`; точный хеш
  сохраняется в истории Git, отдельный коммит ради записи собственного хеша не
  создаётся.
- Восстановление: перед применением миграций на внешнем окружении требуется
  штатная резервная копия БД. Миграции не удаляют прежние таблицы назначений.

### 2026-10-01 · Навигация корневых разделов и рабочих пространств

- Статус: **Готово локально, не закоммичено и не выложено**. Изменения находятся
  только в ветке `codex/access-control-v2`; VDS, GitHub и `main` не менялись.
- Для разделов «Сайт», «Настройки» и «Контент-центр» разделены действия названия
  и стрелки. Если список закрыт, оба элемента раскрывают его и открывают
  корневую вкладку раздела. Если список открыт, название возвращает в корневую
  вкладку и оставляет список раскрытым, а стрелка только сворачивает список без
  изменения текущей страницы.
- Благодаря этому из «Общих данных» снова можно вернуться на корневую страницу
  «Настройки» нажатием на название раздела. Та же логика применяется к дочерним
  страницам «Сайта» и «Контент-центра».
- Аналогичная модель добавлена дереву рабочих пространств. Выбранное пространство
  и раскрытый список сайтов теперь хранятся независимо: название всегда открывает
  страницу пространства, закрытая стрелка раскрывает список и также открывает
  пространство, а открытая стрелка только скрывает сайты, не меняя содержимое
  справа. Одновременно раскрывается не больше одного пространства.
- Строка пространства приведена к геометрии корневой строки меню сайта:
  280×38 px при sidebar 300 px, отдельная кнопка стрелки 32×32 px, одинаковые
  hover/focus-состояния и плавный поворот шеврона.
- Файлы / модули: обработчики меню в `apps/web/src/app/page.tsx`; браузерная
  регрессия в `apps/web/test/site-shell-navigation.spec.ts`; общие стили строк
  и стрелок в `apps/web/src/app/globals.css`.
- БД — схема и данные: не менялись, миграций нет.
- Проверки: TDD RED → GREEN для полной матрицы закрытого/открытого списка,
  названия и стрелки во всех трёх разделах и рабочем пространстве. Браузерный
  тест отдельно сравнивает ширину и высоту строки пространства с корневой
  строкой меню сайта.
- Коммит реализации: не создан — только после локальной проверки владельцем.
- Выкладка: не выполнялась.

### 2026-10-01 · Полировка «Команды и доступов» и защищённая смена пароля администратора

- Статус: **Готово локально, не закоммичено и не выложено**. Изменения находятся
  только в ветке `codex/access-control-v2`; VDS, GitHub и `main` не менялись.
- Исправлена вертикальная компоновка редактора пользователя: заголовок и нижняя
  панель действий всегда остаются внутри модального окна, а центральная часть
  получает всю доступную высоту и собственную прокрутку. Поэтому увеличение
  списка сайтов и раскрытие формы «Новый пароль» больше не обрезают кнопки
  «Отмена» и «Сохранить изменения». Для динамической высоты viewport используется
  `dvh`; прокрутка не передаётся странице под модальным окном.
- В форме сброса пароля подпись «Новый временный пароль» заменена на «Новый
  пароль»: CMS сохраняет заданное значение как обычный постоянный пароль и не
  требует его обязательной смены при следующем входе.
- Таблица и модальное окно приведены к единой типографике sidebar: увеличены
  читаемость и размеры управляющих элементов, исправлен переключатель статуса,
  роль переведена с системного browser-select на кастомный доступный список.
  Чекбоксы сайтов и дополнительных прав получили единое оформление, а сетка
  сайтов — внутренние разделители без наложения нижних границ.
- Контент-менеджер может выбрать несколько сайтов, счётчик «Выбрано» меняется
  сразу. Владелец по-прежнему ограничен одним сайтом; пункт «Требует
  согласования» для владельца не выводится и сервер всегда сохраняет для него
  `requiresApproval=false`.
- Для администратора Wispo обычная смена пароля отключена на уровне API. Из
  профиля и собственного окна пользователя отправляется одноразовая ссылка на
  зарегистрированный email. Ссылка действует 30 минут, хранится в БД только в
  виде SHA-256-хеша и после успешной смены помечается использованной. Изменение
  увеличивает `session_version`, поэтому все прежние сессии администратора
  перестают приниматься сервером.
- Добавлена отдельная публичная страница `/reset-admin-password`, на которой
  вводится новый пароль. Для локальной проверки в `compose.local.yaml` подключён
  изолированный Mailpit на `http://localhost:8025`; он относится только к Docker
  этого проекта и не использует OpenServer.
- БД — схема: миграция
  `1791613200000-AdminPasswordEmailConfirmation.ts`; поле
  `users.session_version`, таблица `admin_password_resets`, уникальный хеш токена,
  срок действия, отметка использования и индекс пользователя/даты.
- БД — данные и формат: существующим пользователям миграция задаёт
  `session_version=0`; пароли и пользовательские назначения не меняются.
- Проверки: RED → GREEN для API и браузерных сценариев; production-сборки API и
  web успешны. Проверены кастомный выбор роли, несколько сайтов, неизменный
  единичный выбор владельца, отсутствие согласования у владельца, геометрия
  переключателя 40×22 и запрос email-ссылки. Отдельная браузерная регрессия на
  коротком desktop viewport проверяет, что центральная часть действительно
  прокручивается, footer остаётся неподвижным и целиком помещается в модальном
  окне; тот же сценарий дополнительно пройден на ширине 390 px. Контрольные
  изображения сохранены вне репозитория в папке визуализаций Codex.
- Коммит реализации: не создан — только после локальной проверки владельцем.
- Выкладка: не выполнялась; для будущего окружения потребуются `PUBLIC_APP_URL`,
  `SMTP_HOST`, `SMTP_PORT` и при необходимости `SMTP_USER`, `SMTP_PASS`,
  `SMTP_SECURE`, `MAIL_FROM`.
- Восстановление: откат миграции удаляет таблицу одноразовых ссылок и поле версии
  сессии; до коммита/выкладки откат не требуется.

### 2026-10-01 · Команда и доступы: сводная таблица и единый редактор

- Статус: **Готово локально, не закоммичено и не выложено**. Работа выполнена в
  локальной ветке `codex/access-control-v2`; `main`, VDS и preview не менялись.
- Исправлена прямая навигация: после обновления страницы адрес `?view=team`
  восстанавливает раздел «Команда и доступы», а не возвращает администратора к
  списку всех проектов.
- Таблица пользователей стала обзорной: отдельно показаны имя и email, роль,
  сайты, включённые дополнительные возможности, статус и действие
  «Редактировать». До трёх сайтов перечисляются через `/`, больше трёх — как
  количество с корректным склонением. Для администратора показываются «Все сайты»
  и «Полный доступ».
- Редактирование перенесено в модальное окно. В нём можно изменить имя, одну из
  трёх ролей, статус, сайты, доступ к коду и требование согласования; email остаётся
  неизменяемым. Сброс временного пароля сохранён в том же окне.
- Правила ролей применяются сервером атомарно: администратор получает все сайты;
  владелец — ровно один сайт без согласования; контент-менеджер — один или несколько
  сайтов и обе дополнительные настройки. Собственную учётную запись администратора
  нельзя отключить или понизить через этот экран.
- БД — схема: без новых миграций. Локальный smoke-тест сохранил существующего
  контент-менеджера с теми же значениями; логический состав данных не изменился.
- Проверки: TypeScript и адресный ESLint web, production-сборки API/web,
  48 API-тестов прав и DTO, unit-тест сводного отображения, 20 браузерных
  сценариев навигации/ролей. Дополнительно в живой локальной CMS подтверждены
  PATCH `200`, закрытие модального окна после сохранения и отсутствие ошибок
  консоли после авторизации.

### 2026-10-01 · Ширина sidebar, селектор сайта и корневые настройки — этап 6

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: ширина левого sidebar увеличена с 230 до 300 px.
  Внутренняя рабочая ширина навигации, дерева проектов, дочерних пунктов,
  профиля и всплывающих блоков теперь рассчитывается от единых CSS-токенов и
  составляет 280 px. Выбранный сайт получил тот же цветной маркер с инициалом,
  который используется в выпадающем списке. Высота селектора уменьшена до
  44 px, а пунктов списка — до 40 px. Вложенный пункт «Управление» удалён:
  существующая форма названия сайта, системного адреса и получения заявок
  открывается непосредственно по корневому пункту «Настройки», имеет заголовок
  «Настройки» и чистый URL `view=settings` без
  `settings=management`. Внутреннее значение `management` сохранено только
  как технический идентификатор существующей формы и для совместимости старых
  ссылок.
- Файлы / модули: структура меню и URL в
  `apps/web/src/app/page.tsx`; заголовок корневой формы в
  `apps/web/src/app/site-settings-view.tsx`; токены размеров и компактный
  селектор в `apps/web/src/app/globals.css`; browser-регрессия в
  `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; локальные записи и Docker volumes не менялись.
- Совместимость / пересечения с параллельной работой: серверные права, API,
  публикация и версионность не менялись. Старый адрес с
  `settings=management` по-прежнему читается, но новые переходы его больше не
  создают. На мобильном breakpoint sidebar сохраняет прежнюю ширину 100%.
- Проверки и оставшиеся ограничения: два новых UI-контракта прошли RED → GREEN;
  полный Playwright-набор оболочки прошёл 19/19. ESLint изменённых файлов и
  production-сборка Next.js успешны. В Playwright визуально проверен поток
  администратора на 1440×1000; после авторизации ошибок и предупреждений в
  console нет. На ширинах 1024 и 390 px горизонтальное переполнение отсутствует.
  Контрольные изображения до и после сохранены вне репозитория как
  `wispo-sidebar-before-300.png` и `wispo-sidebar-after-300.png`.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview, GitHub и `main` не менялись.
- Восстановление: изменения только в web-коде, UI-тесте и документации;
  миграции и восстановление БД не требуются.

### 2026-10-01 · Финальная корректировка меню сайта — этап 5

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: вложенные списки «Сайт», «Настройки» и
  «Контент-центр» теперь плавно раскрываются и закрываются без размонтирования
  содержимого. В карточке выбранного сайта и в выпадающем списке сайтов убраны
  повторяющиеся подписи рабочего пространства, при этом цветные иконки сайтов
  в списке сохранены. SEO перенесён из закреплённого низа в основную иерархию
  сразу после Content Center. После сворачивания sidebar остаётся отдельная
  видимая кнопка, которая гарантированно возвращает меню. Для владельца сайта
  верхняя часть sidebar показывает только назначенный сайт без шеврона,
  переключателя пространства и повторного выбора сайта; администратор Wispo
  сохраняет переключатель пространства и список сайтов. Поведение
  контент-менеджеров с несколькими назначениями не ограничивалось. Повторный
  клик по названию уже активного раздела «Сайт», «Настройки» или
  «Контент-центр» сворачивает его список, следующий клик раскрывает его обратно;
  текущий экран и URL при этом сохраняются.
- Файлы / модули: структура и ролевая логика sidebar в
  `apps/web/src/app/page.tsx`; анимации и стили элементов управления в
  `apps/web/src/app/globals.css`; browser-регрессия в
  `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; локальные записи и Docker volumes не менялись.
- Совместимость / пересечения с параллельной работой: серверная модель прав,
  API, публикация и версионность не менялись. Правка продолжает ранее
  реализованную единую оболочку сайта и заменяет зафиксированное на этапе 3–4
  положение SEO в нижней части меню на согласованное положение внутри основной
  иерархии.
- Проверки и оставшиеся ограничения: шесть новых browser-сценариев сначала
  подтвердили прежнее поведение (RED), затем полный Playwright-набор оболочки
  прошёл 18/18. ESLint изменённых файлов и production-сборка Next.js успешны.
  Полный ESLint проекта по-прежнему останавливается на двух существовавших до
  этапа ошибках `@next/next/no-assign-module-variable` в
  `content-center-creation-render.test.mjs` и
  `content-center-sources.test.mjs`. Визуально зафиксированы меню
  администратора с иконками сайтов, кнопка возврата свёрнутого sidebar и
  непереключаемая шапка владельца на 1440×1000.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview, GitHub и `main` не менялись.
- Восстановление: изменения только в web-коде, UI-тесте и документации;
  миграции и восстановление БД не требуются.

### 2026-10-01 · Настройки и Content Center внутри сайта — этапы 3–4

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: в CMS выбранного сайта создан единый раскрываемый
  корень «Настройки». Внутри него находятся «Общие данные», «Подключение»,
  «Управление», «Домен», «Даты» и «Продукт». Пункты открывают существующие
  функциональные экраны, а монолитный экран управления разделён на адресные
  представления: управление названием и заявками, домен и DNS, системные даты,
  тип продукта и связанный коммерческий сайт. Пункт SEO оставлен отдельным в
  нижней части меню; общий пункт истории из sidebar убран, поскольку история
  версий доступна в контексте редактируемых сущностей. «Контент-центр» удалён
  из дерева рабочего пространства и перенесён внутрь выбранного сайта. Он
  раскрывает «Подготовку информации», «Исследование и анализ» и «Создание
  контента», сохраняет оболочку сайта, меняет URL через History API и
  восстанавливает выбранный экран после перезагрузки. Старые URL Content Center
  с `workspace` автоматически переводятся в контекст первого доступного сайта.
- Файлы / модули: состояние, URL и sidebar в
  `apps/web/src/app/page.tsx`; адресные представления управления в
  `apps/web/src/app/site-settings-view.tsx`; клиентская матрица прав в
  `apps/web/src/app/site-access.ts` и `site-access.spec.ts`; browser-регрессия
  в `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; настройки и Content Center продолжают использовать
  существующие API и таблицы. Локальный Docker-стек перезапускался с
  `.env.local`, данные PostgreSQL находятся в прежнем именованном volume.
- Совместимость / пересечения с параллельной работой: серверная модель Content
  Center по-прежнему относится к рабочему пространству, но пользовательский
  вход в неё теперь выполняется из CMS конкретного сайта. Контент-менеджер без
  права управления настройками видит в группе только «Общие данные»;
  владелец и администратор Wispo видят все шесть пунктов. Обычный
  контент-менеджер не видит «Шаблоны и чанки», менеджер с правом кода видит и
  редактирует их, а владелец сохраняет просмотр для согласования без права
  редактировать HTML. Переходы между «Сайтом», «Настройками» и Content Center
  не перезапускают анимацию меню, потому что тип оболочки не меняется.
- Проверки и оставшиеся ограничения: новые сценарии сначала подтвердили старое
  поведение (RED), затем прошли 2/2. Ролевая проверка владельца и двух вариантов
  контент-менеджера прошла 2/2.
  Полный Playwright-набор оболочки и навигации — 14/14; ESLint изменённых
  файлов и production-сборка Next.js успешны. Визуально проверены экраны
  «Управление» и загруженный корень Content Center на 1440×1000; контрольные
  изображения сохранены в `.tmp/wispo-stage3-settings.png` и
  `.tmp/wispo-stage4-content-center.png`.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview, GitHub и `main` не менялись.
- Восстановление: изменения только в web-коде, тестах и документации;
  миграции и восстановление БД не требуются.

### 2026-10-01 · Иерархия раздела «Сайт» — этап 2

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: для media-сайта Skinova пункт «Сайт» стал отдельным
  кликабельным корнем навигации. Нажатие на название открывает обзорный экран,
  отдельный геометрический шеврон сворачивает и разворачивает дочерние страницы:
  «Главная», «Статьи», «Шапка и подвал», «Политика» и «404». Системные страницы
  «Политика» и «404» доступны в навигации даже до создания их контентных записей.
  Инструменты «Шаблоны и чанки», «Переменные», «Баннеры» и «Медиатека» убраны
  из sidebar и оставлены карточками на корневом экране «Сайт» в этом порядке.
  «Баннеры» больше не скрываются из-за отсутствия найденных banner slots.
- Файлы / модули: навигация и состояние раскрытия в
  `apps/web/src/app/page.tsx`, карточки корневого экрана в
  `apps/web/src/app/media-site-view.tsx`, стили иерархии в
  `apps/web/src/app/globals.css`, browser-регрессия в
  `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; локальные данные не менялись.
- Совместимость / пересечения с параллельной работой: модель ролей и серверные
  права не менялись. Карточка «Шаблоны и чанки» по-прежнему видна только при
  наличии права просмотра CMS-кода. Навигация не-media сайтов сохранена.
  Группировка «Настроек» и перенос Content Center намеренно оставлены следующим
  отдельным этапам.
- Проверки и оставшиеся ограничения: два новых сценария сначала дали ожидаемый
  RED 2/2, затем прошли 2/2; отдельная проверка порядка карточек также прошла
  RED → GREEN. Полный Playwright-набор навигации — 11/11; ESLint изменённых
  TSX-файлов и production-сборка web успешны. Read-only браузерная проверка
  подтвердила пять дочерних страниц, четыре карточки в утверждённом порядке и
  полное скрытие дочерней группы по шеврону.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview, GitHub и `main` не менялись.
- Восстановление: изменения только в web-коде, стилях, тесте и документации;
  миграции и восстановление БД не требуются.

### 2026-10-01 · Очистка верхней части sidebar — этап 1

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: на корневом экране проектов убраны поиск, неактивная
  кнопка уведомлений, дублирующая строка поиска и отдельная нижняя ссылка
  «Команда и доступы». Редкие действия администратора Wispo перенесены в меню
  профиля: «Настройки платформы», «Команда и доступы» и «Журнал изменений».
  Смена административного экрана обновляет URL без перезагрузки страницы, но
  больше не подменяет дерево проектов отдельным меню «Управление Wispo».
  Компактные поиск и уведомления остаются только внутри выбранного сайта;
  поиск сохраняет контекст и меню сайта.
- Файлы / модули: `apps/web/src/app/page.tsx`,
  `apps/web/src/app/globals.css`,
  `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; локальные данные не менялись.
- Совместимость / пересечения с параллельной работой: роли и серверные права не
  менялись. Инструменты сайта, его пункты меню, Content Center и состав экрана
  «Настройки» на этом этапе не перестраивались.
- Проверки и оставшиеся ограничения: новые сценарии сначала дали ожидаемый RED
  3/3, после реализации прошли 3/3. Полный Playwright-набор навигации — 9/9;
  ESLint изменённых TSX-файлов и production-сборка web успешны. Read-only
  браузерная проверка подтвердила: на корне 0 кнопок поиска/уведомлений и 0
  дублирующих строк поиска; в профиле 5 ожидаемых действий; внутри Skinova по
  одной компактной кнопке поиска и уведомлений и без второй строки поиска.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview, GitHub и `main` не менялись.
- Восстановление: изменения только в web-коде, стилях, тесте и документации;
  миграции и восстановление БД не требуются.

### 2026-10-01 · Единая оболочка платформы и сайта

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: переход администратора Wispo из списка проектов в CMS
  выбранного сайта теперь происходит внутри одной оболочки. Существующее левое
  меню заменяет содержимое на разделы сайта, а справа меняется рабочая область;
  второй фиксированный sidebar больше не создаётся. URL обновляется через
  History API без перезагрузки документа. Администратор может вернуться кнопкой
  «Все проекты». Владелец и контент-менеджер при входе сразу открывают первый
  назначенный им сайт, не попадая на платформенный список проектов. Смена
  разделов сопровождается короткой анимацией: рабочая область проявляется
  слева направо со сдвигом на 10 px за 220 мс. Меню проявляется со сдвигом
  на 6 px за 180 мс только при смене его типа: дерево проектов или CMS сайта.
  Раскрытие пространства и навигация внутри одного типа меню
  анимацию меню не перезапускают. Компоненты не размонтируются, поэтому
  локальное состояние форм сохраняется.
- Файлы / модули: оболочка и восстановление маршрута в
  `apps/web/src/app/page.tsx`, раскладка sidebar в
  `apps/web/src/app/globals.css`, регрессионный браузерный сценарий в
  `apps/web/test/site-shell-navigation.spec.ts`.
- БД — схема: нет, миграций нет.
- БД — данные и формат: нет; локальные пользователи и контент не менялись.
- Совместимость / пересечения с параллельной работой: модель ролей и серверные
  ограничения не менялись. Существующие идентификаторы `site` и `view` в URL
  сохранены. При возврате на платформенный экран параметры сайта и Content
  Center удаляются из URL. Для пользователей с `prefers-reduced-motion`
  анимация полностью отключается.
- Проверки и оставшиеся ограничения: ESLint изменённых TSX-файлов успешен;
  production-сборка web успешна; Playwright-регрессия администратора, владельца,
  направления и длительности анимации, неизменного меню при раскрытии пространства
  и переходе между разделами, а также reduced motion — 6/6. Отдельный QA-сценарий
  подтвердил один sidebar шириной 230 px, начало контента на 230 px, сохранение
  текущего документа при переходе и корректный возврат на `/`. Точная переработка
  состава и визуальной иерархии пунктов меню по последним комментариям клиента
  остаётся следующим UI-этапом; в этой итерации устранено именно появление
  отдельного меню и добавлен плавный переход внутри единой оболочки.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview и `main` не менялись.
- Восстановление: изменения только в web-коде и тесте; для отката достаточно
  отменить эту локальную правку, миграции и восстановление БД не требуются.

### 2026-10-01 · Упрощение ролей и права на уровне сайта

- Статус: **Готово локально, не выложено; ожидает проверки владельца**.
- Владелец / задача / ветка: задача Романа / Codex,
  `codex/access-control-v2`; коммита пока нет.
- Что изменено и зачем: модель доступа переведена на три сущности:
  администратор Wispo, владелец сайта и контент-менеджер. Для каждого назначения
  на сайт отдельно хранятся право редактирования CMS-кода и требование
  согласования. Отдельная роль разработчика исключается; управление аккаунтами
  остаётся только у администратора Wispo. Владелец без права редактирования кода
  может прочитать точную отправленную кодовую ревизию, одобрить и опубликовать
  её, но не может создавать или менять HTML.
- Файлы / модули: сущности и миграция в `apps/api/src/database`; единая матрица
  прав, workflow и журнал ревизий в `apps/api/src/content`; auth, audit,
  privacy, Content Center и управление пользователями; web-сессия, меню сайта,
  глобальный экран «Команда и доступы» и редакторы версионных ресурсов.
- БД — схема: подготовлена аддитивная миграция
  `1791523200000-SiteAccessAssignments.ts`: новая таблица `site_accesses`
  с уникальным назначением `user_id + site_id`, ролью, `can_edit_code` и
  `requires_approval`. Существующие legacy-таблицы не удаляются.
- БД — данные и формат: перед миграциями создан локальный dump
  `.tmp/site-access-before-migrations-2026-10-01.dump`. Все 47 миграций
  применены только к локальной PostgreSQL. Backfill создал три назначения
  Luminava/Skinova: владелец без редактирования кода, обычный
  контент-менеджер и контент-менеджер с правом кода; у всех локальных
  назначений согласование выключено. Рабочая, preview- и VDS-БД не менялись.
- Совместимость / пересечения с параллельной работой: старые
  `workspace_memberships` сохранены только как совместимый слой для старых
  данных; site-level авторизация и интерфейс используют `site_accesses`.
  Бесшовная навигация платформа → сайт переиспользует существующий History API:
  URL, меню и контент меняются без полной перезагрузки. `AGENTS.md` и
  `.codex/` в реализацию не входят.
- Проверки и оставшиеся ограничения: целевые тесты прав и workflow — 27/27;
  полный API-набор — 109 suites успешно, 5 пропущено, 694 теста успешно,
  70 пропущено; production-сборки API и web успешны; ESLint всех изменённых
  API/web-файлов успешен. Read-only Playwright-проверка локальной CMS прошла
  для администратора, владельца, менеджера без кода и менеджера с кодом:
  управление пользователями доступно только администратору, меню соответствует
  флагам, владелец видит HTML только для проверки, отдельная роль разработчика
  не показывается. Полный repository-wide lint по-прежнему содержит старые,
  не относящиеся к этой задаче ошибки в двух web-тестах и нескольких API-тестах.
  Специализированный UI согласования публикаций Content Center остаётся
  отдельным будущим этапом; сервер не разрешает обход прав.
- Коммит реализации: не создан — только после локальной проверки и отдельного
  подтверждения владельца.
- Выкладка: не выполнялась; VDS, preview и `main` не менялись.
- Восстановление: локальный dump создан до применения миграций; миграция
  аддитивная, legacy-назначения не удалены. Восстановление локальной БД не
  требовалось.
### 2026-09-24 · Сбор публичных материалов Ozon

- Статус: **Заблокировано внешним доступом**.
- Владелец / задача / ветка: задача Артёма / Codex, `docs/deepseek-text-release`.
- Что изменено и зачем: проверена возможность отдельного сбора публичной карточки продавца Ozon, товаров и отзывов по ссылке без доступа к кабинету продавца.
- Файлы / модули: только эта запись журнала; серверный сборщик не внедрён, чтобы не выдавать пустую страницу за успешный результат.
- БД — схема: нет.
- БД — данные и формат: нет; миграций нет.
- Совместимость / пересечения: другие маркетплейсы и существующие источники не менялись.
- Проверки и оставшиеся ограничения: публичные товары и тексты отзывов доступны в обычном браузере без кабинета. HTTP с ПК и VDS возвращает циклические 307; Chromium внутри контейнера API на VDS получает страницу Ozon «Похоже, нет соединения» с инцидентом и 0 товаров. Автоматический сбор по одной ссылке на этом VDS не подтверждён. Нужен согласованный другой канал получения публичной страницы либо ручная загрузка материалов.
- Коммит реализации: нет.
- Выкладка: не было.
- Восстановление: код и данные CMS не менялись.

### 2026-09-24 · Короткая подпись материалов проекта

- Статус: **Выложено на тестовый VDS**.
- Владелец / задача / ветка: задача Артёма / Codex, `docs/deepseek-text-release`.
- Что изменено и зачем: подпись сокращена до «Файлы, тексты и ссылки · до 10 МБ»
  и размещена в одну строку в левой колонке.
- Файлы / модули: интерфейс материалов и точечный тест.
- БД — схема: нет.
- БД — данные и формат: нет.
- Совместимость / пересечения: только текст и расположение подсказки.
- Проверки и оставшиеся ограничения: 19 точечных тестов и ESLint прошли.
- Коммит реализации: `c7df8b0`.
- Выкладка: тестовый VDS `wispo-cms.129.101.122.78.nip.io`, 24.09.2026;
  рабочий `cms.kpbox.ru` не переключался. Текст страницы проверен в браузере.
- Восстановление: вернуть прежнюю подпись и ширину колонки.

### 2026-09-24 · Выбор маркетплейса в материалах

- Статус: **Выложено на тестовый VDS**.
- Владелец / задача / ветка: задача Артёма / Codex, `docs/deepseek-text-release`.
- Что изменено и зачем: ссылки на Ozon, Wildberries и Яндекс Маркет добавляются
  через выбор площадки с локальными значками и проверкой домена.
- Файлы / модули: форма и список материалов, значки маркетплейсов, тесты.
- БД — схема: нет.
- БД — данные и формат: нет; существующая категория `marketplace`.
- Совместимость / пересечения: автоматический сбор отзывов и товаров не меняется.
- Проверки и оставшиеся ограничения: 20 точечных тестов, TypeScript и ESLint
  прошли; доступность данных зависит от публичных страниц площадок.
- Коммит реализации: `c81d1fd`.
- Выкладка: тестовый VDS `wispo-cms.129.101.122.78.nip.io`, 24.09.2026;
  рабочий `cms.kpbox.ru` не переключался. Окно проверено во встроенном браузере.
- Восстановление: вернуть прежнее общее поле ссылки для категории.

### 2026-09-24 · Наглядный ход подготовки информации

- Статус: **Выложено на тестовый VDS**.
- Владелец / задача / ветка: задача Артёма / Codex, `docs/deepseek-text-release`.
- Что изменено и зачем: вместо одного текста показать реальные этапы и счётчик
  текущей операции рядом с запуском долгой обработки.
- Файлы / модули: интерфейс подготовки информации, его стили и точечные тесты.
- БД — схема: нет.
- БД — данные и формат: нет; используются существующие `progress` в запуске.
- Совместимость / пересечения: без изменения очереди, AI и готовых версий.
- Проверки и оставшиеся ограничения: 19 точечных тестов, TypeScript и ESLint
  прошли. Процент относится к текущей операции с известным числом частей, не
  ко всему AI-запуску: число аналитических шагов может изменяться по ходу работы.
- Коммит реализации: `d7c4f71`.
- Выкладка: тестовый VDS `wispo-cms.129.101.122.78.nip.io`;
  рабочий `cms.kpbox.ru` не переключался.
- Восстановление: возврат интерфейса к прежней строке состояния.

### 2026-09-24 · Перенос Wispo CMS на сервер заказчика

- Статус: **Выложено; старая установка выведена из эксплуатации**.
- Владелец / задача / ветка: задача Артёма / Codex, перенос окружения.
- Что изменено и зачем: новый VDS `129.101.122.78` стал рабочим источником
  данных; прежний сервер больше не обслуживает CMS и не нужен для её работы.
- Файлы / модули: `deploy/compose.customer.yaml`,
  `deploy/customer-backup.cron`, `deploy/nginx.old-redirect.conf`,
  `deploy/CUSTOMER-MIGRATION.md` и окружение серверов.
- БД — схема: миграций нет; на обоих серверах было по 46 миграций.
- БД — данные и формат: новая БД не заменялась старым дампом, потому что на
  новом VDS уже 9 версий, а на старом было 7. Старые данные после первого
  переноса не менялись. Права сотрудников не менялись.
- Совместимость / пересечения: на старом общем сервере удалены только
  контейнеры, тома, образы, каталоги, задания и журналы Wispo; другие проекты
  не затронуты. Старые адреса временно перенаправляют на VDS заказчика.
- Проверки и ограничения: актуальные БД, медиа и код обоих окружений сохранены
  на ПК владельца и сверены по SHA-256; дамп новой БД восстановлен в отдельную
  базу. После остановки старой CMS администратор открыл версию 9 в браузере;
  3 контейнера здоровы, web/API HTTP 200. Ежедневный локальный бэкап включён.
  Внешний автоматический бэкап пока не настроен по выбору пользователя;
  полный цикл аудиорасшифровки не проверен. Почта временно отключена по
  решению пользователя, контактные формы без клиентского SMTP не отправляют.
- Коммит реализации: `f4ab0eb`.
- Выкладка: рабочий адрес `https://wispo-cms.129.101.122.78.nip.io/`,
  24.09.2026; старый `cms.kpbox.ru` отдаёт HTTP 302, его API — 410.
- Восстановление: проверенные архивы на ПК владельца и ежедневные копии на
  VDS; детали и ограничения в `deploy/CUSTOMER-MIGRATION.md`.

### 2026-09-24 · Текстовый резерв для ступеней AI-подготовки

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `fix/deepseek-text-fallback`.
- Что изменено и зачем: при некорректной JSON-обёртке ответа DeepSeek текстовые
  ступени обработки (реестр фактов и итоговый документ) один раз запрашивают тот
  же фрагмент в обычном текстовом формате. Сломанный ответ не сохраняется;
  проверка структуры и пределов размера остаётся. Структурированные операции
  отбора страниц и создания статей по-прежнему требуют JSON.
- Файлы / модули: DeepSeek-адаптер в `apps/api`, адресные тесты.
- БД — схема: нет, миграций нет.
- БД — данные и формат: существующие контрольные точки остаются совместимыми;
  подтверждённые части сбойного запуска повторно не отправляются.
- Совместимость / пересечения: материалы, роли, публикация и другие источники
  не меняются. При сбое JSON-формата возможен один дополнительный платный
  вызов DeepSeek только для этого фрагмента.
- Проверки и оставшиеся ограничения: 52 адресных теста, ESLint и сборка API.
  Реальный сбойный запуск продолжен с 10 сохранённых контрольных точек:
  обработаны 22 части первого этапа и объединение, создана и открыта версия 7.
  В этом прогоне ошибка JSON не повторилась; срабатывание текстового резерва
  проверено тестом, а не реальным ответом DeepSeek. Внешний DeepSeek может быть
  недоступен; резерв не сохраняет пустой или подозрительный ответ.
- Коммит реализации: `38c4796`; merge в `main` —
  `cf1828fec26fd87830ef237476d110804570c9c3`.
- Выкладка: preview `cms.kpbox.ru`, 24.09.2026 по Москве. Обновлён только
  API-образ; web и PostgreSQL не перезапускались, миграций нет. После успешного
  запуска мониторинг подтвердил 3 контейнера и 3 адреса, TLS и резервные копии.
- Восстановление: прежний API-образ `wispo-cms-api:pre-text-cf1828f` и
  исходный релиз `/opt/wispo-cms-releases/wispo-cms-20260924-pre-text-cf1828f`;
  миграций и backfill нет.

### 2026-09-23 · Устойчивость длительной обработки DeepSeek

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `fix/deepseek-preparation-reliability`.
- Что изменено и зачем: временный сбой соединения, некорректная оболочка ответа
  или HTTP 429/5xx повторяются один раз с паузой. Ошибки ключа, баланса и
  неверного запроса не повторяются. При сбое одного параллельного фрагмента
  остальные завершаются и сохраняют контрольные точки; общий лимит большого
  запуска увеличен с 15 до 45 минут. Продолженный запуск получает новый отсчёт
  ожидания очереди, не меняя исходную дату создания: прежде старая дата
  приводила к немедленному объявлению запуска просроченным.
- Файлы / модули: DeepSeek-адаптер, поэтапная AI-подготовка и очередь в
  `apps/api`, адресные тесты.
- БД — схема: нет, миграций нет.
- БД — данные и формат: существующие `cc_preparation_checkpoints` сохраняют
  подтверждённые промежуточные ответы; формат не меняется.
- Совместимость / пересечения: материалы, роли и публикация не меняются.
  Дополнительный вызов при временной ошибке может увеличить расход API;
  число попыток ограничено двумя на запрос.
- Проверки и оставшиеся ограничения: 51 адресный тест, ESLint, Prettier и
  сборка API. Интеграционный тест очереди дополнен проверкой продолжения
  старого запуска; отдельная локальная PostgreSQL-база не настроена. На preview
  продолжен реально сбойный запуск с сохранённых контрольных точек: временный
  обрыв ответа повторён автоматически, создана и открыта версия 6. Повторение
  не гарантирует успех при длительной недоступности DeepSeek.
- Коммиты реализации: `3f2f9ca`, `f133599`; merge в `main` —
  `2bfcf897bdd471f04d8987ce90432cdf6e7ebd01`,
  `81afa3c24cb3d7c2d045713f67f0fbd98d9a96e2`.
- Выкладка: preview `cms.kpbox.ru`, 23.09.2026. Обновлён только API-образ;
  web и PostgreSQL не перезапускались. Мониторинг после успешного прогона:
  три контейнера и три адреса доступны, TLS и резервные копии в норме.
- Восстановление: прежний API-образ `wispo-cms-api:pre-queue-81afa3c` и
  исходный релиз `/opt/wispo-cms-releases/wispo-cms-20260923-pre-queue-81afa3c`;
  миграций и backfill нет.

### 2026-09-23 · Текст документов для подготовки AI

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `docs/preview-release-20260923`.
- Что изменяется и зачем: выбранные DOCX и PDF, включая уже загруженные,
  извлекаются в текст перед запуском DeepSeek. Модель не меняется; неоткрываемый
  или не содержащий текста документ не должен молча попадать в запрос.
- Файлы / модули: обработка файлов и запуск подготовки в `apps/api`,
  профильные тесты и зависимости API.
- БД — схема: нет, миграций нет.
- БД — данные и формат: оригиналы `cc_materials` не переписываются;
  извлечённый текст сохраняется только в существующем поле
  `cc_preparation_runs.input_context.materials[].content` нового запуска.
- Совместимость / пересечения: работа Романа, роли, публикация и другие
  источники не меняются. Изображения и прочие бинарные форматы пока остаются
  отдельным неподдерживаемым случаем с явным сообщением.
- Проверки и оставшиеся ограничения: 4 адресных теста прошли, в том числе
  DOCX в сценарии запуска и настоящий разбор PDF отдельным Node-процессом;
  адресный ESLint, Prettier и API-сборка прошли. Интеграционный PostgreSQL-тест
  обновлён, но локальная отдельная тестовая БД здесь не настроена, поэтому он
  не запускался. Сканированные PDF, изображения, XLSX и PPTX требуют отдельной
  обработки и не отправляются в AI молча.
- Коммит реализации: `fbe87cf`; merge в `main` —
  `7036938bdde71e642b5980c2d7c0023f4f24299f`.
- Выкладка: preview `cms.kpbox.ru`, 23.09.2026. Обновлён только API-образ;
  web и PostgreSQL не перезапускались, миграций нет. Проверены API health,
  открытие страницы контент-центра и диалога запуска в авторизованной сессии,
  мониторинг: 3 контейнера и 3 адреса доступны, TLS и резервные копии в норме.
  Платный AI-запуск с клиентскими материалами не выполнялся.
- Восстановление: прежний API-образ
  `wispo-cms-api:pre-document-7036938` и прежний исходный релиз
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-document-7036938`;
  миграций и backfill нет.

### 2026-09-23 · VK: 200 публикаций без ограничения по дате

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: просматриваются до 200 последних записей стены VK без
  отсечения по дате; дата каждого поста сохраняется, в окне показываются число
  включённых и причины исключения; старые посты обозначаются архивными для AI.
- Файлы / модули: VK-сборщик, подготовка AI, окно источников и тесты.
- БД — схема: нет. Миграций нет.
- БД — данные и формат: в JSON страниц VK добавляется `publishedAt` (ISO UTC)
  для каждой полученной публикации; следующий явный сбор заменит снимок,
  старые снимки автоматически не переписываются.
- Совместимость / пересечения: остальные источники и версии AI не меняются.
- Проверки и оставшиеся ограничения: 44 профильных API-теста, 22 web-теста,
  адресный ESLint и production-сборки API/web прошли. После выкладки оба
  контейнера healthy, API и оба адреса CMS отвечают. Read-only сбор
  `vk.ru/crazy.studio` из API-контейнера получил 159 записей, 138 включено,
  21 исключена; самая старая доступная — 25.09.2017. Снимок проекта не
  изменён: нужен явный клик «Обновить сбор». Во встроенном Browser открылась
  форма входа; авторизованное окно источников не проверено.
- Коммит реализации: `7dd1510b73fd33608ddef5b5eaf6531975ca53a7`.
- Выкладка: preview `cms.kpbox.ru`, 23.09.2026; обновлены API и web,
  миграций нет.
- Восстановление: исходный каталог в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-vk-history-7dd1510`,
  прежние образы `wispo-cms-api:pre-vk-history-20260923` и
  `wispo-cms-web:pre-vk-history-20260923`; откат БД не нужен.

### 2026-09-23 · Обновление карточки 2ГИС из поисковой ссылки

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: принимается публичная ссылка 2ГИС вида
  `/город/search/запрос/firm/числовой-id`, сбор идёт по канонической карточке
  `/город/firm/id`; прежде такая сохранённая ссылка не проходила проверку API.
- Файлы / модули: `apps/api/src/content-center/2gis-map-source.ts` и тест.
- БД — схема: нет. Миграций нет.
- БД — данные и формат: нет; существующие ссылки не переписываются.
- Совместимость / пересечения: обычные ссылки 2ГИС и другие карты не меняются.
- Проверки и оставшиеся ограничения: профильные тесты (3), адресный ESLint и
  сборка API прошли. API healthy; из контейнера по сохранённой ссылке получены
  обзор, 3 отзыва, 7 товаров и услуг, особенности. Снимок проекта не изменён:
  сохранение ссылки не запускает сбор, нужен клик «Обновить сбор».
- Коммит реализации: `a171c042b7fe93797e32ae4038e0925b26abbe6c`.
- Выкладка: preview `cms.kpbox.ru`, 23.09.2026; обновлён только API-контейнер,
  миграций нет.
- Восстановление: исходный каталог в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-2gis-search-a171c04`, прежний
  образ `wispo-cms-api:pre-2gis-search-20260923`; откат БД не нужен.

### 2026-09-23 · Публичные отзывы Google Maps

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: дополнить прежний обзор карточки публично видимыми
  текстами отзывов, не показывать недоступные отзывы и товары как подтверждённый
  ноль. Если Google временно скрывает отзывы, повторный сбор не затирает
  ранее сохранённые тексты. Полный архив без входа Google не гарантируется.
- Файлы / модули: Google Maps collector и тесты, защита обновления снимка,
  источник в web, зависимости API и Docker-образ с Chromium.
- БД — схема: нет. Миграций нет.
- БД — данные и формат: существующий JSON снимка источника дополняется
  `map.reviews`, числом `map.reviewCount` при доступности и разделом
  `Google Maps · Отзывы` в `pages`; старые снимки остаются совместимы.
- Совместимость / пересечения: сборы Яндекса и 2ГИС не меняются. API-клиент и
  клиентский доступ Google не требуются; контейнер API становится тяжелее.
- Проверки и оставшиеся ограничения: 9 адресных тестов, ESLint, сборка API/web
  и production-сборка обоих контейнеров прошли. Изолированный контейнер на
  хостинге без входа собрал 11 текстов из 297 отзывов контрольной карточки;
  повторный запуск получил только обзор, так как Google скрыл вкладку. После
  выкладки API/web healthy, HTTP 200; встроенный Browser открыл форму входа,
  но авторизованной сессии для проверки окна источника нет. Штатный монитор
  указал на устаревшую резервную копию медиатеки — это отдельное состояние.
- Коммит реализации: `f033a6f`.
- Выкладка: `cms.kpbox.ru`, 23.09.2026, API и web из `f033a6f`; миграций нет.
- Восстановление: исходный каталог в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-google-reviews`, прежние
  образы `wispo-cms-api:pre-google-reviews-20260923` и
  `wispo-cms-web:pre-google-reviews-20260923`; откат БД не нужен.

### 2026-09-23 · Короткий выбор общего промпта

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: убрать лишнюю подпись и оставить на кнопке «Выбрать».
- Файлы / модули: `apps/web/src/app/content-center/global-prompt-picker.tsx`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: логика выбора промпта не меняется.
- Проверки и оставшиеся ограничения: адресный ESLint и production web build
  прошли; авторизованная визуальная проверка недоступна в текущей сессии Browser.
- Коммит реализации: `f033a6f`. Выкладка: `cms.kpbox.ru`, 23.09.2026.
- Восстановление: возврат прежнего текста кнопки и подписи.

### 2026-09-23 · Полировка окна запуска обработки

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: сделать список источников и две колонки окна спокойнее,
  убрать повтор имени файла и визуальный шум от длинных ссылок/прокрутки.
- Файлы / модули: экран подготовки, его CSS и адресный тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: выбор источников, промпт и запуск не меняются.
- Проверки и оставшиеся ограничения: production web build, адресный ESLint,
  профильный тест и `git diff --check` прошли. Авторизованная визуальная
  проверка остаётся недоступной без сессии во встроенном Browser; после
  выкладки он открыл форму входа. API/web — healthy и HTTP 200.
- Коммит реализации: `6909ea4`.
- Выкладка: `cms.kpbox.ru`, 23.09.2026, web из `6909ea4`; миграций нет.
- Восстановление: копия файлов в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-launch-polish`, прежний образ
  `wispo-cms-web:pre-launch-polish-20260923`; БД не меняется.

### 2026-09-23 · Окно запуска обработки с выбором материалов

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: оставить справа компактный запуск и историю, а выбор
  существующих материалов проекта и цели обработки перенести в окно запуска.
  Передавать в AI только выбранные материалы, сохраняя точный снимок запуска.
- Файлы / модули: экран подготовки, DTO/API запуска, снимок входа AI,
  профильные тесты.
- БД — схема: нет. Миграций нет.
- БД — данные и формат: `cc_preparation_runs.input_context.materials` содержит
  выбранное подмножество материалов; существующие версии и старые запуски не
  меняются. При запуске из нового окна предыдущий результат не передаётся в AI.
- Совместимость / пересечения: старые вызовы API без `materialIds` по-прежнему
  используют все материалы; режим продолжения не теряет снимок источников.
- Проверки и оставшиеся ограничения: API/web production build, адресные ESLint,
  DTO unit-тесты, web-тест нового окна и интеграционный сценарий на отдельной
  PostgreSQL-базе прошли. Полный файл web-тестов содержит прежнее несвязанное
  падение проверки `nginx.preview.conf` (две одинаковые директивы
  `microphone=(self)` уже в HEAD). Встроенный Browser открыл только форму входа;
  авторизованный экран не проверен. После выкладки API/web — healthy и HTTP 200.
- Коммит реализации: `e96ffea`.
- Выкладка: `cms.kpbox.ru`, 23.09.2026, API и web из `e96ffea`; миграций нет.
- Восстановление: копия исходных файлов в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-launch-dialog`, прежние образы
  `wispo-cms-api:pre-launch-dialog-20260923` и
  `wispo-cms-web:pre-launch-dialog-20260923`; откат без изменения схемы БД.

### 2026-09-23 · Продолжение обработки с сохранённых этапов

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: сохранять завершённые ответы отдельных AI-этапов,
  вручную продолжать неудачный запуск с того же снимка источников; показывать
  более точную категорию ошибки DeepSeek и этап сбоя. Автоматических платных
  повторов нет, непроверенный ответ не становится версией.
- Файлы / модули: AI-подготовка, очередь контент-центра, DeepSeek-адаптер,
  API продолжения, кнопка подготовки, профильные тесты.
- БД — схема: миграция `PreparationCheckpoints1791436800000` добавляет
  `cc_preparation_checkpoints` и `cc_preparation_runs.resume_count`.
- БД — данные и формат: после неудачи входной снимок и ответы завершённых
  этапов хранятся до 7 дней; после успеха и по истечении срока удаляются.
  Старые неудачные запуски без снимка продолжить нельзя. Созданные версии не
  меняются до полного успешного завершения.
- Совместимость / пересечения: продолжение разрешено только для последнего
  неудачного запуска при прежних материалах, инструкции, промпте и базовой
  версии. Изменение модели/настроек или системного промпта аннулирует кеш
  отдельных ответов. Сбор источников и задачи создания контента не меняются.
- Проверки и оставшиеся ограничения: 45 unit-тестов AI/DeepSeek, 7 адресных
  интеграционных тестов на отдельной PostgreSQL-базе, миграция на копии рабочей
  БД, API/web production build, адресный ESLint и web-тест прошли. API/web —
  HTTP 200 и healthy. Встроенный Browser показал страницу входа; проверка
  авторизованного экрана недоступна без сессии. Монитор сообщает только о
  старой резервной копии медиатеки — вне этой правки.
- Коммит реализации: `eead950`.
- Выкладка: `cms.kpbox.ru`, 23.09.2026, API и web из `eead950`;
  миграция `PreparationCheckpoints1791436800000` применена.
- Восстановление: проверенный дамп БД
  `/root/wispo-cms-backups/database/wispo-20260922T223306Z.sql.gz`, копии кода
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-preparation-checkpoints`,
  прежние образы `wispo-cms-api:pre-preparation-checkpoints-20260923` и
  `wispo-cms-web:pre-preparation-checkpoints-20260923`. Откат приложения на
  прежние образы возможен без разрушительного `down`; добавленные таблица и
  колонка остаются до отдельного согласованного удаления.

### 2026-09-23 · Статус обработки рядом с запуском

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: удалить большую карточку процесса; показывать короткий
  статус с индикатором рядом с кнопкой запуска, а историю поднять сразу под
  формой обработки.
- Файлы / модули: `apps/web/src/app/content-center/content-center-view.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/src/app/content-center/preparation-state.ts`,
  `apps/web/test/content-center-preparation.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет.
- Совместимость / пересечения: статус и ошибки берутся из прежнего API;
  очередь и создание версий не меняются.
- Проверки и оставшиеся ограничения: два профильных теста, адресный ESLint,
  TypeScript и production-сборка прошли; web и API ответили HTTP 200. Встроенный
  Browser показал страницу входа, авторизованная проверка недоступна без сессии.
- Коммит реализации: `4bd450b`.
- Выкладка: `cms.kpbox.ru`, 23.09.2026, web из `4bd450b`; миграций нет.
- Восстановление: копии файлов в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-inline-run-status`, прежний
  образ `wispo-cms-web:pre-inline-run-status-20260923`; БД не менялась.

### 2026-09-23 · Макет списка промптов

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: вернуть окну списка промптов стандартную шапку и
  прокручиваемое тело с отступами; ограничить предпросмотр так, чтобы действие
  и пояснение не обрезались на невысоких экранах.
- Файлы / модули: `apps/web/src/app/content-center/global-prompt-picker.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-preparation.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет.
- Совместимость / пересечения: выбор и сохранение промпта не меняются; тот же
  диалог используется на экранах подготовки, исследования и создания.
- Проверки и оставшиеся ограничения: адресный тест, ESLint, TypeScript и
  production web build прошли; web и API отвечают HTTP 200. Встроенный браузер
  показывает форму входа, авторизованный вид окна недоступен.
- Коммит реализации: `9ce8c5f`.
- Выкладка: 23.09.2026, обновлён только web-контейнер preview на
  `cms.kpbox.ru`.
- Восстановление: копии изменённых файлов сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-prompt-picker`, образ
  `wispo-cms-web:pre-prompt-picker-20260923`; БД не менялась.

### 2026-09-23 · Подсказки категорий под заголовками

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: пояснения к категориям источников перенесены под их
  заголовки слева и оформлены как спокойный вспомогательный текст.
- Файлы / модули: `apps/web/src/app/content-center/project-materials.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-materials.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет.
- Совместимость / пересечения: меняется только представление строк материалов;
  добавление, просмотр и удаление не затронуты.
- Проверки и оставшиеся ограничения: 17 профильных тестов, адресный ESLint,
  TypeScript и production web build прошли; web и API отвечают HTTP 200.
  Встроенный браузер показывает форму входа, авторизованный вид недоступен.
- Коммит реализации: `abc0e88`.
- Выкладка: 23.09.2026, обновлён только web-контейнер preview на
  `cms.kpbox.ru`.
- Восстановление: копии изменённых файлов сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-source-hints`, образ
  `wispo-cms-web:pre-source-hints-20260923`; БД не менялась.

### 2026-09-23 · Компактная панель обработки и истории

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: убрать ручное имя и отдельное сохранение задачи;
  оставить выбор промпта, инструкцию и запуск; перенести процесс и историю
  версий в правую колонку, чтобы экран подготовки был компактнее.
- Файлы / модули: `apps/web/src/app/content-center/content-center-view.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-preparation.test.mjs`.
- БД — схема: нет.
- БД — данные и формат: новые поля и миграции не нужны; сохранение задачи при
  запуске использует существующий API и хранит снимок названия промпта.
- Совместимость / пересечения с параллельной работой: существующие версии и
  сохранённые задачи остаются совместимыми.
- Проверки и оставшиеся ограничения: два профильных теста, адресный ESLint и
  TypeScript и production web build прошли; web и API отвечают HTTP 200.
  Встроенный браузер показывает только форму входа, поэтому авторизованный
  вид страницы пока нельзя визуально проверить.
- Коммит реализации: `3ec6485`.
- Выкладка: 23.09.2026, обновлён только web-контейнер preview на
  `cms.kpbox.ru`.
- Восстановление: копии изменённых файлов сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-preparation-compact`, образ
  `wispo-cms-web:pre-preparation-compact-20260923`; БД не менялась.

### 2026-09-23 · Двухколоночная подготовка материалов

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: материалы и форма обработки располагаются рядом на
  широком экране и переходят в одну колонку при нехватке места; убрана лишняя
  подсказка про типы сайтов.
- Файлы / модули: `apps/web/src/app/content-center/content-center-view.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/src/app/content-center/materials.ts`,
  `apps/web/src/app/content-center/project-materials.tsx`, два профильных теста.
- БД — схема: нет.
- БД — данные и формат: нет.
- Совместимость / пересечения с параллельной работой: только разметка и стили
  страницы подготовки, контракты API не меняются.
- Проверки и оставшиеся ограничения: 16 тестов материалов и новый тест раскладки,
  адресный ESLint, TypeScript и production web build прошли. Существующий тест nginx-политики
  микрофона падает из-за двух вхождений вместо одного; конфиг не менялся.
  Web и API отвечают HTTP 200. Встроенный браузер дошёл до формы входа,
  авторизованная страница недоступна.
- Коммит реализации: `b5140ce`.
- Выкладка: 23.09.2026, обновлён только web-контейнер preview на `cms.kpbox.ru`.
- Восстановление: копии изменённых файлов сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-preparation-columns`, образ
  `wispo-cms-web:pre-preparation-columns-20260923`; БД не менялась.

### 2026-09-23 · Плашки форматов из Crazy CRM

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: значки файлов в «Материалах проекта» заменены на
  компактные цветные SVG-плашки по образцу локального Crazy CRM.
- Файлы / модули: `apps/web/src/app/content-center/materials.ts`,
  `apps/web/src/app/content-center/project-materials.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-materials.test.mjs`, `docs/file-icons.md`,
  `apps/web/public/icons/files/`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: действия с материалами и допустимые типы файлов
  не меняются; заменяется только визуальное обозначение типа.
- Проверки и оставшиеся ограничения: профильный тест (15 тестов), адресный
  ESLint, TypeScript и production web build прошли. Browser smoke дошёл до
  формы входа; авторизованный экран материалов в этой сессии недоступен.
- Коммит реализации: `9ac0cc0`.
- Выкладка: preview `cms.kpbox.ru`, 23.09.2026; обновлён web-контейнер.
  HTTP 200, здоровье web-контейнера и API health подтверждены.
- Восстановление: сохранены каталог
  `/opt/wispo-cms-releases/wispo-cms-20260923-pre-crm-badges-9ac0cc0` и образ
  `wispo-cms-web:pre-crm-badges-9ac0cc0`; откат БД не требуется.

### 2026-09-22 · Значки форматов материалов проекта

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: в строке «Материалы проекта» рядом с файлами и
  ручными текстами появились локальные значки форматов Microsoft Fluent UI.
- Файлы / модули: `apps/web/src/app/content-center/project-materials.tsx`,
  `apps/web/src/app/content-center/materials.ts`,
  `apps/web/public/icons/files/`, `apps/web/test/content-center-materials.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: только визуальное отображение существующих
  материалов; загрузка, скачивание, редактирование и удаление не меняются.
- Проверки и оставшиеся ограничения: профильный тест (15 тестов), адресный
  ESLint, TypeScript, проверка SVG и production web build прошли. Browser
  smoke дошёл до формы входа; авторизованный экран материалов недоступен.
- Коммит реализации: `9917f96`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; обновлён web-контейнер.
  Значок DOCX отдаётся с HTTP 200, web-контейнер здоров, API health прошёл.
- Восстановление: сохранены каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-file-icons-9917f96` и образ
  `wispo-cms-web:pre-file-icons-9917f96`; откат БД не требуется.

### 2026-09-22 · Единая строка материалов проекта

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: «Другие источники» стали «Материалами проекта»;
  ссылки, файлы и тексты добавляются в одной строке вместо отдельной таблицы.
- Файлы / модули: `apps/web/src/app/content-center/materials.ts`,
  `apps/web/src/app/content-center/project-materials.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-materials.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: существующие файлы, тексты и ссылки остаются в
  прежних записях; меняется только представление и точка добавления.
- Проверки и оставшиеся ограничения: профильный тест (14 тестов), адресный
  ESLint, TypeScript и production web build прошли. Browser smoke подтвердил
  форму входа; авторизованный экран материалов в текущей сессии недоступен.
- Коммит реализации: `56bad94`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; обновлён web-контейнер.
  HTTP 200, здоровье web-контейнера и API health подтверждены.
- Восстановление: сохранены каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-materials-56bad94` и образ
  `wispo-cms-web:pre-materials-56bad94`; откат БД не требуется.

### 2026-09-22 · Надёжное закрытие голосового окна

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: окно «Голосовой ввод инструкции» переведено с нативного
  modal-режима на управляемый слой интерфейса. Крестик, «Отмена», Escape и клик
  по затемнению теперь закрывают окно напрямую и не оставляют его поверх всей
  страницы.
- Файлы / модули: `apps/web/src/app/content-center/speech-input.tsx`,
  `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-speech-input.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: распознавание речи, разрешение микрофона и
  добавление текста не меняются; изменён только способ показа и закрытия окна.
- Проверки и оставшиеся ограничения: профильный тест (2 теста), адресный ESLint
  и production web build прошли. Browser smoke на опубликованном адресе дошёл
  до формы входа; авторизованный экран диктовки в текущей сессии не проверен.
- Коммит реализации: `b6d5248`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; обновлён только web-контейнер,
  API health и web HTTP 200 подтверждены.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-speech-overlay-b6d5248`;
  откат выполняется возвратом прежней web-версии.

### 2026-09-22 · Кнопка обновления для карт

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: окно «Источники и охват» теперь показывает «Обновить
  сбор» для всей категории «Карты и отзывы», включая сохранённую карточку 2ГИС.
  Раньше проверка подписи карты могла скрыть кнопку до первого сбора.
- Файлы / модули: `apps/web/src/app/content-center/source-refresh.tsx`,
  `apps/web/test/content-center-source-refresh.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: изменён только доступ к запуску сбора в UI;
  API по-прежнему валидирует поддерживаемый адрес карты перед постановкой в
  очередь. 2ГИС, Яндекс и Google не получают новых разрешений или ключей.
- Проверки и оставшиеся ограничения: профильный тест (9 тестов), адресный
  ESLint и production web build прошли. Browser smoke на опубликованном адресе
  дошёл до формы входа; авторизованный список источников в текущей сессии не
  проверен.
- Коммит реализации: `dc45b89`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; обновлён только web-контейнер,
  API health и web HTTP 200 подтверждены.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-map-refresh-dc45b89`;
  откат выполняется возвратом прежней web-версии.

### 2026-09-22 · Числовые подписи карточек карт

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: в списке источников Яндекс.Карт, 2ГИС и Google Maps
  подпись карточки показывает только числовой идентификатор, когда он есть;
  полный URL сохраняется в ссылке, подсказке и данных материала.
- Файлы / модули: `apps/web/src/app/content-center/materials.ts`,
  `apps/web/src/app/content-center/project-materials.tsx`,
  `apps/web/test/content-center-materials.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: изменено только отображение подписи; сбор,
  редактирование и сохранённые адреса источников не меняются. Google Maps
  без числового `cid` сохраняет компактный URL как резервную подпись.
- Проверки и оставшиеся ограничения: профильный тест (14 тестов), адресный
  ESLint и production web build прошли. Browser smoke на опубликованном адресе
  дошёл до формы входа; авторизованный список источников в текущей сессии не
  проверен.
- Коммит реализации: `617c0fe`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; обновлён только web-контейнер,
  API health и web HTTP 200 подтверждены.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-map-id-617c0fe`;
  откат выполняется возвратом прежней web-версии.

### 2026-09-22 · Надёжное закрытие окна голосового ввода

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: крестик, «Отмена» и запуск микрофона теперь закрывают
  нативное окно голосового ввода сразу, а не только через отложенное изменение
  состояния React. Повторное открытие не вызывает `showModal()` для уже открытого
  окна.
- Файлы / модули: `apps/web/src/app/content-center/speech-input.tsx`,
  `apps/web/test/content-center-speech-input.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: исправлена только логика окна голосового ввода;
  распознавание, текстовая подстановка и разрешения браузера не меняются.
- Проверки и оставшиеся ограничения: профильный speech-input test, адресный
  ESLint и web production build прошли. В полном preparation-тесте остаётся
  прежнее несоответствие в nginx Permissions-Policy (две строки
  `microphone=(self)` вместо ожидаемой одной).
- Коммит реализации: `dc85b51`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; web-контейнер пересобран,
  API health и web HTTP 200 подтверждены.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-speech-consent-close-dc85b51`;
  откат выполняется возвратом прежней web-версии.

### 2026-09-22 · Общие промпты подготовки информации

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: общий раздел подготовки теперь собирает профиль
  компании, продукты и услуги, отзывы, точки внимания и большую итоговую
  сводку. Исследовательские выводы и конкурентный анализ остаются в разделе
  «Исследование и анализ».
- Файлы / модули: `deploy/seed-content-center-prompts.cjs`,
  `deploy/seed-content-center-prompts.test.cjs`,
  `apps/api/src/database/migrations/1791264000000-PreparationGeneralPrompts.ts`,
  `apps/api/src/database/migrations/1791350400000-RemoveLegacyCompetitorStarter.ts`,
  `docs/content-center-starter-prompts.md`.
- БД — схема: нет. БД — данные и формат: миграции обновляют только нетронутый
  стартовый промт «Анализ компании», переименовывает нетронутый конкурентный
  шаблон в «Отзывы и обратная связь», добавляют «Общая сводка компании» и
  удаляют оставшуюся точную копию старого конкурентного шаблона;
  пользовательские правки и скопированные инструкции не перезаписываются.
- Совместимость / пересечения: специализированные шаблоны магазина,
  лендинга, брифа и статьи сохранены; следующий раздел исследования не меняется.
- Проверки и оставшиеся ограничения: seed-тест и API production build прошли;
  API health и web HTTP 200 после выкладки подтверждены. Browser smoke в
  текущей сессии дошёл до формы входа, авторизованный список промптов не
  проверен.
- Коммит реализации: `c985e16`, `ef4f407`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; применены миграции
  `PreparationGeneralPrompts1791264000000` и
  `RemoveLegacyCompetitorStarter1791350400000`.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-general-prompts-ef4f407`;
  миграции с пользовательскими правками не откатываются автоматически.

### 2026-09-22 · Выравнивание окна голосового ввода

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: окно подтверждения голосового ввода переведено на
  общую шапку и прокручиваемое тело модальных окон; исправлены внутренние
  отступы и визуальное выравнивание без изменения логики распознавания.
- Файлы / модули: `apps/web/src/app/content-center/speech-input.tsx`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: только внешний вид и структура одного окна;
  состояние микрофона, разрешения и текстовые сообщения не меняются.
- Проверки и оставшиеся ограничения: адресный ESLint, speech-input test
  (2 теста) и production web build прошли; авторизованный Browser smoke
  недоступен в текущей сессии.
- Коммит реализации: `3f02045`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; web healthy, HTTP 200, API
  healthy.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-speech-dialog-3f02045`;
  откат выполняется возвратом прежней web-версии.

### 2026-09-22 · Сбор публичной карточки Google Maps

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: в источниках «Карты и отзывы» добавлен публичный
  сбор карточки Google Maps без клиентского входа, OAuth и ключа API — по той же
  схеме, что Яндекс Карты и 2ГИС. Собираются обзор, контакты, координаты,
  рейтинг, часы работы и доступные особенности; Google не отдаёт текст
  отдельных отзывов обычным публичным preview-ответом, поэтому это ограничение
  сохраняется в предупреждении снимка и не маскируется под полный архив.
- Файлы / модули: `apps/api/src/content-center/google-maps-source.ts`,
  `google-maps-source.spec.ts`, `public-material.ts`,
  `preparation-collection.service.ts`, `content-center.service.ts`,
  `preparation-ai.service.ts`, `content-center.module.ts`; web-тип карточки,
  распознавание Google Maps, обновление сбора и реестр источников.
- БД — схема: нет. БД — данные и формат: без изменения существующего формата
  материалов; миграции не планируются.
- Совместимость / пересечения: существующие сборщики Яндекс Карт, 2ГИС,
  сайтов и социальных сетей не меняются; расширен только общий тип снимка
  карты и безопасное чтение JSON-ответов.
- Проверки и оставшиеся ограничения: адресные ESLint; API — 74 набора,
  446 тестов пройдены (включая 2 теста Google Maps); web production build
  успешен. Живой сбор карточки Googleplex подтвердил название, адрес, телефон,
  сайт, координаты, рейтинг 4,1, 9 668 заявленных отзывов и график работы.
  Browser smoke опубликованного адреса дошёл до формы входа; авторизованный
  клик в интерфейсе в текущей сессии не подтверждён.
- Коммит реализации: `b8f78da`.
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; API healthy, web HTTP 200.
- Восстановление: перед выкладкой сохранён каталог
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-google-b8f78da`; возврат
  выполняется восстановлением этого каталога и прежних preview-образов.

### 2026-09-22 · Незаметная прокрутка окна источников

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: полоса прокрутки в окне «Источники и охват» скрыта
  визуально, но прокрутка колёсиком, тачпадом и клавиатурой сохранена; это
  убирает обрезанные стрелки у скруглённых краёв.
- Файлы / модули: `apps/web/src/app/content-center/content-center-view.module.css`,
  `apps/web/test/content-center-preparation.test.mjs`.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: изменён только внешний вид общего тела диалога;
  содержимое, шапка и закрытие окна не меняются.
- Проверки и оставшиеся ограничения: профильный тест, адресные ESLint и
  TypeScript, production web build прошли. Browser smoke дошёл до формы входа;
  авторизованный визуальный просмотр окна в текущей сессии недоступен.
- Коммит реализации и выкладка: `8ac3682978f2ae55f5cbca9834246be516af5c82`;
  web-контейнер обновлён 22.09.2026. Health-check API/web прошёл. Штатный
  монитор снова сообщил об устаревшей резервной копии медиатеки, отдельно от
  этой правки.
- Восстановление: исходный каталог сохранён в
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-dialog-scrollbar`, web-образ
  — `wispo-cms-web:pre-dialog-scrollbar`; миграции и откат БД не требуются.

### 2026-09-22 · Фиксированная шапка окна источников

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: окно «Источники и охват» получает отдельную
  прокручиваемую область содержимого, чтобы заголовок и кнопки оставались
  доступными; клик по свободной области затемнения закрывает окно.
- Файлы / модули: `apps/web/src/app/content-center/content-center-view.tsx`,
  `content-center-view.module.css`, профильный web-тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: меняется только общий компонент диалога
  контент-центра; содержимое и действия источников не меняются.
- Проверки и оставшиеся ограничения: профильный web-тест добавлен; 12 тестов
  этого файла прошли, один существующий тест микрофона падает из-за
  параллельного изменения shell-маршрута. Изменённый компонент прошёл
  адресные ESLint и TypeScript, production web build успешен. Browser smoke
  на 1360 px дошёл до формы входа, поэтому авторизованный клик по источнику
  не подтверждён в текущей сессии.
- Коммит реализации и выкладка: `2bc740890ffed22642783bccacf002e2336715c9`;
  web-контейнер обновлён 22.09.2026. Health-check API/web прошёл. Штатный
  монитор приложения остановился на устаревшей резервной копии медиатеки;
  это не связано с изменением окна и требует отдельной эксплуатационной
  проверки.
- Восстановление: исходный каталог сохранён в
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-source-dialog`, web-образ —
  `wispo-cms-web:pre-source-dialog`; миграции и откат БД не требуются.

### 2026-09-22 · Официальные иконки карт и Google Maps

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: в выборе источника «Карты и отзывы» добавлен Google
  Maps. Ссылки Яндекс Карт, 2ГИС и Google Maps распознаются автоматически, а
  сохранённые источники получают соответствующий официальный логотип вместо
  буквенной заглушки.
- Файлы / модули: `map-material-fields.tsx`, `project-materials.tsx`,
  `social-icon.tsx`, `apps/web/public/icons/maps/*.svg`.
- БД — схема: нет. БД — данные и формат: нет; формат существующих материалов
  не меняется.
- Миграции: нет.
- Совместимость / пересечения: структурированный сбор по-прежнему подключён
  только для Яндекс Карт; 2ГИС и Google Maps сохраняют публичную ссылку и
  доступный текст страницы без отдельного структурированного адаптера.
- Проверки и оставшиеся ограничения: `git diff --check`, ESLint затронутых
  файлов и web build пройдены. Встроенный browser smoke без авторизации видит
  публичную страницу входа; экран материалов не проверялся.
- Коммит реализации и выкладка: `514a25ec98a26bc3be2187137ad4ba9a30020157`,
  production-preview переключён 22.09.2026. Web health-check пройден,
  `https://cms.kpbox.ru` отвечает 200.
- Восстановление: прежний исходный каталог сохранён в
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-map-icons-514a25e`;
  прежний web-образ сохранён как `wispo-cms-web:pre-map-icons-514a25e`.

### 2026-09-22 · Сбор публичной карточки 2ГИС

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: подключён сбор доступных данных публичной карточки
  2ГИС без клиентского входа, OAuth и ключа API — по аналогии с существующим
  сбором Яндекс Карт. Сохраняются обзор, контакты, часы, рейтинг, доступные
  отзывы, цены и особенности карточки.
- Файлы / модули: `apps/api/src/content-center/2gis-map-source.ts`, общий
  reader публичных страниц, реестр сбора и отображение карточки в web.
- БД — схема: нет. БД — данные и формат: без изменения существующего формата
  материалов; миграции не планируются.
- Совместимость / пересечения: Яндекс Карты и общий сбор сайтов не меняются.
- Проверки и оставшиеся ограничения: API Jest 444 passed / 63 skipped, адресный
  ESLint и API build пройдены; web build пройден. На проверенной публичной
  карточке 2ГИС собраны 3 отзыва и 7 позиций цен. Это только публичный SSR-
  ответ; закрытые данные и архив, который страница не отдаёт, не считаются
  собранными. Профильный web-тест содержит отдельный уже существовавший сбой
  счётчика `microphone=(self)` в nginx и не относится к 2ГИС.
- Коммит реализации: `2a1ac0b` (`feat(content-center): collect public 2gis cards`).
- Выкладка: preview `cms.kpbox.ru`, 22.09.2026; API healthy, web HTTP 200.
  Применённых миграций нет.
- Восстановление: сохранены предыдущие образы и архив в
  `/opt/wispo-cms-releases/wispo-cms-20260922-pre-2gis-2a1ac0b`; возврат к ним
  выполняется штатным rollback compose.

### 2026-09-21 · Выбор источника карт в материалах

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: категория «Карты и отзывы» открывает отдельную компактную
  форму с кнопками «Яндекс Карты» и «2ГИС», как в форме социальных сетей. Ссылка
  проверяется на соответствие выбранной площадке; существующий сборщик Яндекс
  Карт получает правильный тип источника.
- Файлы / модули: `map-material-fields.tsx`, форма материалов и иконки источников.
- БД — схема: нет. БД — данные и формат: нет; используется существующая
  категория `maps`.
- Миграции: нет.
- Совместимость / пересечения: социальные сети и сайты не меняются; ссылки карт
  сохраняются через прежний API материалов.
- Проверки и оставшиеся ограничения: ESLint затронутых файлов и web build
  пройдены. Яндекс подключён к структурированному сбору; для 2ГИС на этом шаге
  сохраняется публичная ссылка и доступный текст страницы без отдельного
  структурированного адаптера.
- Коммит реализации и выкладка: `1089849a4566b6a054994671a282c10de74009cb`,
  production-preview переключён 21.09.2026. Web health-check пройден,
  `https://cms.kpbox.ru` отвечает 200.
- Восстановление: прежний исходный каталог сохранён в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-map-picker-1089849`.

### 2026-09-21 · Публичная карточка Яндекс Карт

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменено и зачем: добавляется отдельный сборщик публичной HTML-карточки
  Яндекс Карт без OAuth, API-ключа, входа и обращения к внутренним RPC. Он
  сохраняет обзор, доступные отзывы, товары и услуги, график и особенности;
  разделы, которые отданы только счётчиком или требуют клиентской загрузки,
  помечаются как неполные.
- Файлы / модули: `yandex-map-source.ts`, очередь сбора источников и реестр
  источников web.
- БД — схема: нет. БД — данные и формат: используется существующее JSON-поле
  `cc_materials.site_pages`; снимок получает режим `map-card` и объект `map`.
- Миграции: нет.
- Совместимость / пересечения: существующие материалы и источники не меняются;
  сбор выполняется только после явного обновления источника.
- Проверки и оставшиеся ограничения: API build, web build, ESLint затронутых
  файлов, точечные тесты сборщика и реальный публичный smoke на карточке
  Crazy Studio пройдены. Новости в публичном HTML отдаются только счётчиком;
  обход капчи, авторизации и внутренних API не выполняется.
- Коммит реализации и выкладка: `03d15c18c65a35fc0e6252b187f79bd1f1330303`,
  production-preview переключён 21.09.2026. API и web прошли health-check,
  публичный адрес `https://cms.kpbox.ru` отвечает 200. Для отката сохранён
  исходный каталог в `/opt/wispo-cms-releases/wispo-cms-20260921-pre-yandex-maps-eca3b0b-retry`;
  миграций нет. Скрипт мониторинга отдельно отметил устаревший медиабэкап,
  не связанный с этим релизом.

### 2026-09-21 · Материалы без отдельного подтверждения

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: кнопка «У меня нет материалов» убирается. Пустой
  список материалов становится допустимым состоянием автоматически: пользователь
  может сразу сохранить задачу или запустить обработку одной инструкции, а файл
  или текст добавить при необходимости.
- Файлы / модули: экран подготовки контент-центра и его профильный web-тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет. Существующее поле
  `withoutMaterials` передаётся автоматически по фактической пустоте списка.
- Совместимость / пересечения: API-контракт не меняется; работа Романа не
  затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: новая точечная регрессия пустого списка,
  ESLint изменённого TSX-файла и `git diff --check` пройдены. В полном файле
  подготовки 11/12 проверок проходят; отдельная существующая проверка nginx
  ожидает одну политику микрофона, тогда как в текущей конфигурации их две, и
  к этой правке интерфейса не относится. Production-сборка web, health-check,
  оба публичных домена и штатный монитор прошли. Встроенный Browser после
  обновления отрисовал форму входа; авторизованная проверка экрана ограничена
  истёкшей production-сессией.
- Коммит реализации и выкладка:
  `16cf8b79dd9b4905f1f9cf285b0ae8394619cd43`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-empty-materials-16cf8b7`,
  прежний образ — `wispo-cms-web:pre-empty-materials-b96cf04`; возврат ручного
  переключателя не требует изменения данных.

### 2026-09-21 · Удаление пояснения под шапкой источников

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: из окна «Источники и охват» убирается лишняя подсказка
  «Только сбор публикаций — без AI и изменения версий» и её вертикальный зазор.
  Кнопка «Обновить сбор» остаётся в шапке слева от крестика.
- Файлы / модули: компонент обновления источника, CSS контент-центра и
  профильный web-тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: запуск и состояния сбора не меняются; работа
  Романа не затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: 8/8 точечных тестов обновления источников,
  ESLint изменённого TSX-файла, `git diff --check` и production-сборка web
  пройдены. Web healthy, оба публичных домена и штатный монитор прошли.
  Встроенный Browser после обновления отрисовал форму входа; авторизованная
  проверка окна ограничена истёкшей production-сессией.
- Коммит реализации и выкладка:
  `b96cf047d6eebff08930ee45de63753079204cc0`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-remove-hint-b96cf04`,
  прежний образ — `wispo-cms-web:pre-remove-hint-062f945`; возврат подсказки не
  требует изменения данных.

### 2026-09-21 · Кнопка обновления в шапке источников

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: «Обновить сбор» переносится в шапку окна «Источники
  и охват», слева от крестика с небольшим промежутком. На узком экране кнопка
  остаётся в обычном потоке, чтобы не перекрывать заголовок.
- Файлы / модули: компонент обновления источника и CSS контент-центра.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: запуск и состояния сбора не меняются; работа
  Романа не затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: 8/8 точечных тестов обновления источников,
  ESLint изменённого TSX-файла, `git diff --check` и production-сборка web
  пройдены. Web healthy, оба публичных домена и штатный монитор прошли.
  Встроенный Browser после обновления отрисовал форму входа; авторизованная
  проверка шапки ограничена истёкшей production-сессией.
- Коммит реализации и выкладка:
  `062f94526b0965943e02c3d05ebd4086ff4606a5`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-refresh-header-062f945`,
  прежний образ — `wispo-cms-web:pre-refresh-header-1b089194`; возврат прежнего
  класса вернёт кнопку в строку пояснения.

### 2026-09-21 · Один вид сохранённого текста источника

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: лишний переключатель «Для чтения / Оригинал» в
  карточке источника удаляется. Раскрытый блок сразу показывает сохранённый
  оригинальный текст в читаемой раскладке без пересказа и AI-обработки.
- Файлы / модули: реестр источников, его CSS и профильный web-тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: сохранённые снимки и их исходный текст не
  меняются; убирается только альтернативное представление в интерфейсе.
- Проверки и оставшиеся ограничения: 12 профильных тестов реестра источников,
  ESLint изменённого TSX-файла, `diff --check` и production-сборка web прошли.
  Web healthy, оба публичных домена и штатный монитор прошли. Встроенный Browser
  после обновления отрисовал форму входа; авторизованная проверка карточки
  ограничена истёкшей production-сессией.
- Коммит реализации и выкладка:
  `1b089194209d334e816f665c025e205ef0f5a3c0`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-source-original`, прежний
  образ — `wispo-cms-web:pre-source-original`; возврат компонента-переключателя
  восстановит два режима.

### 2026-09-21 · Мягкий скролл модального окна

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: внешний скролл длинного модального окна
  контент-центра делается тоньше и спокойнее — прозрачная дорожка, светлый
  скруглённый бегунок и более заметное состояние при наведении.
- Файлы / модули: CSS модального окна контент-центра.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: размеры содержимого, прокрутка, внутренние карточки
  и поля не меняются; работа Романа не затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: `diff --check` и production-сборка web
  прошли. Web healthy, оба публичных домена и штатный монитор прошли. Встроенный
  Browser после обновления отрисовал форму входа; авторизованная проверка
  длинного окна ограничена истёкшей production-сессией.
- Коммит реализации и выкладка:
  `702ce2683620d217e0e7513c5a95bee51e03826d`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-dialog-scrollbar`, прежний
  образ — `wispo-cms-web:pre-dialog-scrollbar`; удаление правил scrollbar
  вернёт системное оформление браузера.

### 2026-09-21 · Компактный отступ в окне добавления сайта

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: окно «Добавить сайт» приводится к визуальному ритму
  окна добавления социальной сети — уменьшается только пустой отступ между
  заголовком и полем адреса; кнопка закрытия и остальные диалоги не меняются.
- Файлы / модули: форма сайта и CSS контент-центра.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость / пересечения: поведение формы, API и сохранение ссылки не
  меняются; работа Романа не затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: 4 профильных теста формы сайта, ESLint
  изменённого TSX-файла, `diff --check` и production-сборка web прошли. Web
  healthy, оба публичных домена и штатный монитор прошли. Встроенный Browser
  после обновления отрисовал форму входа; авторизованная проверка окна ограничена
  истёкшей production-сессией. Изменение ограничено одним CSS-классом первого поля.
- Коммит реализации и выкладка:
  `f976a5780f2d57739bf20ae7cba481448ea982f8`; web обновлён 21.09.2026, API и
  БД не перезапускались, миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-site-dialog-spacing`, прежний
  образ — `wispo-cms-web:pre-site-dialog-spacing`; возврат CSS-класса восстановит
  прежний увеличенный отступ.

### 2026-09-21 · Telegram без ограничения по давности

- Статус: **Выложено**.
- Владелец / задача / ветка: задача Артёма / Codex,
  `feature/content-center-preparation-mvp`.
- Что изменяется и зачем: сбор публичного Telegram-канала должен получать до
  100 последних доступных публикаций независимо от даты. Прежнее окно 180 дней
  исключало все записи `crazystudio_blog`, хотя публичная веб-лента их отдаёт.
- Файлы / модули: Telegram-коллектор и его unit-тест, подсказки web-интерфейса,
  профильные web-тесты и эксплуатационная документация.
- БД — схема: не меняется, миграций нет.
- БД — данные и формат: схема JSON не меняется; следующий явный сбор заменит
  текущий снимок источника и сможет добавить старые публикации. Автоматического
  backfill нет.
- Совместимость / пересечения: очередь, AI, Telegram-вложения, репосты и
  комментарии не меняются; работа Романа не затрагивается в известных файлах.
- Проверки и оставшиеся ограничения: 7 unit-тестов Telegram и 15 профильных
  web-тестов прошли; ESLint изменённых API/web-файлов, API build и web TypeScript
  прошли. Реальный read-only сбор `crazystudio_blog` получил описание и 16
  публикаций за 08.03.2025–21.03.2025 (17 загруженных карточек), без AI и записи
  в БД. Production-сборка API/web, health-check, оба публичных домена и штатный
  монитор прошли. Встроенный Browser после обновления отрисовал форму входа;
  проверка авторизованного экрана ограничена истёкшей сессией. Вложения,
  комментарии и репосты по-прежнему не читаются.
- Коммит реализации и выкладка:
  `6cbb64646fbbcb017dc8edb2ddee1440ef17bbab`; API и web обновлены 21.09.2026,
  миграции не применялись.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-telegram-history`, прежние
  образы — `wispo-cms-api:pre-telegram-history` и
  `wispo-cms-web:pre-telegram-history`. Возврат прежнего кода снова ограничит
  новые сборы 180 днями; уже сохранённые снимки автоматически не переписываются.

## Проверенная точка отсчёта — 21.09.2026

- Наша ветка: `feature/content-center-preparation-mvp`.
- Приложение на общем сервере: `16cf8b79dd9b4905f1f9cf285b0ae8394619cd43`.
  Сверено чтением `/opt/wispo-cms/.deployed-commit` 21.09.2026.
- `https://cms.kpbox.ru/` и `https://wispo-cms.45.12.74.66.nip.io/`
  обслуживают один экземпляр CMS и одну PostgreSQL-базу. Смена адреса не создаёт
  независимые данные. Исходники сервера: `/opt/wispo-cms`.
- Версия, окружение, миграции и журнал параллельной работы Романа **не сверены**.
  Нельзя утверждать, что его ветка совместима или что он использует эту же БД.
- Точка сравнения до контент-центра: `b700a0586b840eb53c9e5d39ffd23f9dca3c5ba2`.
  Это историческая база сравнения, а не утверждение о текущем `main`.
- В этой ветке относительно неё добавлены 13 миграций. Все 13 ниже присутствуют
  в прочитанной таблице `migrations` общей БД; всего в ней 35 записей.
  Это проверка истории применения, **не полный аудит фактической схемы или
  всех ручных изменений данных**. SQL/дампы другой рабочей базы не сравнивались.
- В `apps/api/src/database/data-source.ts` включён `migrationsRun: true`,
  `synchronize: false`. При старте API применяются ожидающие миграции.

### Схема и data-migrations контент-центра

Все файлы находятся в `apps/api/src/database/migrations/`. Статус каждой строки:
**Применена на общем сервере**, подтверждено read-only запросом 20.09.2026.

| Миграция / коммит | Изменение схемы | Изменение данных / особенности |
| --- | --- | --- |
| `1790020800000-ContentCenterPreparation.ts` · `f6f3a67` | Созданы `cc_materials`, `cc_prompts`, `cc_preparation_drafts`, `cc_preparation_versions`, `cc_preparation_runs` и индексы. | Новые таблицы; `down` удаляет их с содержимым. |
| `1790107200000-ContentCenterSourceFiles.ts` · `2619d3c` | Поля категории, файла, размера, MIME и ошибки в `cc_materials`. | У существующих строк категория по умолчанию `other`; оригиналы файлов — приватные данные workspace. |
| `1790193600000-ContentCenterResearch.ts` · `96a0fd7` | `cc_research_drafts`, `cc_research_confirmations`, `cc_research_search_locks`. | Черновики/подтверждения исследования и блокировки; `down` удаляет таблицы. |
| `1790280000000-ContentCenterCreation.ts` · `09f34c1` | `cc_creation_settings`, `cc_clusters`, `cc_created_articles`, `cc_created_versions`, `cc_corrections`, `cc_creation_runs`, `cc_creation_events`. | Новые таблицы со связями с существующими сайтами, статьями, категориями и пользователями. |
| `1790340000000-CreationPublicationTargets.ts` · `fc186d4` | `cc_article_publications`. | Переносит существующие связи публикаций из `cc_created_articles`, где заданы статья CMS и её ревизия. |
| `1790400000000-DeepseekIntegration.ts` · `33e4105` | `platform_ai_settings`. | Создаёт начальную строку `deepseek`; ключи из настроек хранятся шифрованными и в журнал не копируются. |
| `1790486400000-GlobalPromptLibrary.ts` · `2cca710` | `platform_prompts`; прежняя `cc_prompts` оставлена для восстановления. | Копирует только известные стартовые промпты по точному названию/хешу, не произвольные клиентские тексты. Автоматический `down` запрещён. |
| `1790572800000-ContentCenterSiteImports.ts` · `9ece553` | `cc_materials.site_pages/site_checked_at`, `cc_preparation_versions.sources`, `cc_preparation_runs.progress/heartbeat_at`. | Новые JSON-снимки источников и прогресс; удаления/переноса прежних строк в `up` нет. |
| `1790659200000-PreparationRequestLabels.ts` · `c180053` | `prompt_title` у черновиков/запусков/версий; `instruction` у версий. | Заполняет историю только при однозначном совпадении успешного запуска и версии; название — при единственном совпадении промпта. |
| `1790745600000-PreparationReadablePrompts.ts` · `3a0242f` | Нет. | Заменяет конкретную старую фразу об источниках у шести стартовых названий в `platform_prompts`, увеличивает ревизию. Не переписывает историю/черновики; автоматического обратного изменения текста нет. |
| `1790832000000-SourceRefreshJobs.ts` · `c224116` | `operation`, `source_material_id` и индекс в `cc_preparation_runs`. | Прежние запуски получают `operation='prepare'`; `collect` используется для сбора без AI. |
| `1790918400000-ContentCenterVkSources.ts` · `c6587f6` | `cc_vk_connections`, уникальный индекс `(workspace_id,id)` у `cc_materials`. | Привязки VK и зашифрованные ключи; удаление материала каскадно удаляет его привязку. |
| `1791004800000-PlatformVkIntegration.ts` · `b7b7202` | `platform_vk_settings`; `cc_vk_connections.encrypted_token` допускает `NULL`. | Создаёт строку `vk`; `NULL` означает общий ключ. Старые зашифрованные подключения сохраняются. `down` не проходит при наличии глобальных подключений с `NULL`. |

Это ретроспективный реестр проверенных миграций и ближайших релизов, а не
полный журнал всех пользовательских действий или всех старых UI-правок.
Точные операции — в миграциях и Git; прежние эксплуатационные сведения — в
[`deploy/OPERATIONS.md`](../deploy/OPERATIONS.md) и документах контент-центра.

## Текущие и последние доработки

### 2026-09-21 · Иконка HTML для сайта в списке источников

- Статус: **Выложено**. Владелец: задача Артёма / Codex,
  ветка `feature/content-center-preparation-mvp`.
- Что изменено: у источников категории «Сайт» появилась цветная иконка HTML из
  каталога Trace Logo’s в той же позиции и размере, что брендовые значки
  социальных сетей. Первоначальный серый глобус заменён как визуально
  диссонирующий с остальными источниками; промежуточный цветной глобус не выпускался.
  В финальной коррекции удалён белый квадрат исходного SVG, а `viewBox` обрезан
  по границам щита: знак теперь заполняет контейнер 20 × 20 наравне с соцсетями.
- Файлы: `project-materials.tsx`, `social-icon.tsx`, профильный web-тест и документация иконок.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Совместимость: URL, сбор, действия и доступные названия кнопок не меняются.
- Проверки: 12 адресных web-тестов, TypeScript, адресный ESLint и `diff --check`
  прошли. В production Browser напрямую подтверждён финальный SVG HTML
  (`viewBox 6.07812 5 19.842 22.5`, четыре контура, фонового `rect` нет).
  Полная повторная проверка внутри списка
  источников ограничена истёкшей авторизацией: оба production-домена показывают
  форму входа; пароль и сессия не изменялись. До коррекции в этом же списке были
  подтверждены прежний текст URL и доступное название кнопки.
- Финальный коммит реализации и выкладка:
  `c4ae6087b9e3a8b3077f287e2c235082f73893bb`; промежуточные варианты
  `6931268e6095dd2514e2aa25a62d1ae2730e999f` и
  `5315bf3765f3803c8a8ae658f83bb937ae894279` заменены. Web-контейнер обновлён
  21.09.2026; API и БД не перезапускались. Оба домена и штатный монитор прошли;
  498 серверных файлов совпали с финальным коммитом.
- Восстановление: исходники до финальной выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-html-icon-fill`, прежний web-образ —
  `wispo-cms-web:pre-html-icon-fill`; изменение БД для отката не требуется.

### 2026-09-21 · Короткое имя YouTube в списке источников

- Статус: **Выложено**. Владелец: задача Артёма / Codex, ветка `feature/content-center-preparation-mvp`.
- Что изменено: только отображение сохранённого YouTube-канала в плашке —
  `youtube.com/@name` сокращается до `@name`; полный URL, редактирование и сбор не меняются.
- Файлы: `apps/web/src/app/content-center/materials.ts`, `project-materials.tsx` и профильный web-тест.
- БД — схема: нет. БД — данные и формат: нет. Миграций нет.
- Проверки: 11 адресных тестов отображения прошли, web TypeScript и адресный ESLint прошли;
  в production Browser подтверждено короткое `@soundyogaschool` при сохранённом полном URL.
  Повторный реальный сбор YouTube завершился успешно: описание канала и 42 видео,
  всего 43 из 43 материалов включены, недоступных нет; AI и новая версия не запускались.
- Коммит реализации и выкладка: `a1d635a64d2916e75ce5a10ffd078065ad6c3b9c`,
  web-контейнер обновлён 21.09.2026; API и БД не перезапускались. Оба production-домена,
  контейнеры, TLS, диск и резервные копии прошли штатный монитор; 497 серверных файлов
  сверены с коммитом без расхождений.
- Восстановление: исходники до выкладки сохранены в
  `/opt/wispo-cms-releases/wispo-cms-20260921-pre-youtube-chip`, прежний web-образ —
  `wispo-cms-web:pre-youtube-chip`; откат не требует изменения БД.

### 2026-09-20 · Instagram и YouTube — сбор источников

- Статус: **Выложено; реальный сбор ожидает настройки внешних приложений**.
  Владелец: задача Артёма / Codex, ветка `feature/content-center-preparation-mvp`.
- Запрос: добавить обе сети как реальные источники, а не только сохраняемые ссылки.
- Область: API коллекторы/настройки и подключение Instagram, очередь подготовки,
  формы соцсетей/настроек/источников и профильные тесты.
- Файлы: `apps/api/src/content-center/{social-*,instagram-*,youtube-source,platform-social-settings.*}`,
  контроллеры/модуль/сервис контент-центра и очередь; формы `apps/web/src/app/content-center`,
  `platform-social-settings.tsx`, локальная иконка Instagram; `deploy/nginx.preview.conf`.
- БД — схема: новая миграция `1791091200000-InstagramYoutubeSources` в `data-source.ts`;
  таблицы `platform_social_settings`, `cc_instagram_connections`, `cc_instagram_oauth_states`.
  Миграция проверена на изолированной тестовой PostgreSQL и применена на общем сервере
  20.09.2026; всего 36 миграций, последняя `InstagramYoutubeSources1791091200000`.
- БД — данные/формат: две пустые строки настроек, без backfill прежних материалов.
  Новые сети используют существующий JSON `site_pages` и очередь. Смена ссылки удаляет
  её Instagram-токен/незавершённые состояния. Исторические версии не переписываются.
  Секреты AES-GCM, OAuth-state хранится хешем; код возврата не журналируется nginx.
- Проверки: 9 тестов API-клиентов/URL/шифрования, 2 новых PostgreSQL-сценария
  (права администратора/workspace, одноразовый/просроченный OAuth, смена приложения,
  привязка профиля, очередь без AI, отказ API и конфликт ревизии) прошли.
  5 тестов существующей очереди и 25 web-тестов прошли; production TypeScript и
  адресный ESLint API/web прошли. Более широкий запуск выявил 3 несовпадения прежних
  ожиданий промптов: snapshots request names, migrates only exact generic starter texts,
  uses only the message after the last material is deleted. Их production-пути этой
  доработкой не менялись; полный набор тестов не объявляется зелёным.
- Совместимость перед релизом: сервер `9f169b7`, 35 применённых миграций; конфигурация nginx
  совпала с канонической, новые таблицы отсутствовали. После fetch в `origin/main` нет новой миграции/пересечения
  с этими таблицами. Неопубликованная работа Романа по-прежнему не проверена.
- Внешняя предпосылка: ключ YouTube Data API; приложение Meta и разрешение
  профессионального Instagram-аккаунта. Реальный сбор без них не подтверждён.
- Коммит реализации: `d9ed6fc83d1c8877d5dcb8ecd43aaffb06691826`; API/web собраны и
  выложены 20.09.2026 в 22:41 МСК. nginx callback применён на обоих доменах.
  Уточнение nginx `184cbd70f6d8574db301dab619f132fb734ab877` отключает также error-log
  URI этого callback; применено без перезапуска API/web. Текущий серверный маркер —
  `184cbd70f6d8574db301dab619f132fb734ab877`; 497 файлов сверены с ним без расхождений.
- Проверки релиза: обе production-сборки, `nginx -t`, API/web healthy, штатный монитор
  на обоих доменах зелёный. В IAB проверены настройки со статусом «Не настроено»,
  переключение YouTube/Instagram, подписи/поля и загрузка всех четырёх иконок;
  в доступном viewport 319 px формы и поля без горизонтального выхода.
  Материалы не сохранялись и AI не запускался; прежние VK/DeepSeek-настройки остались.
- Резервная копия перед миграцией:
  `/root/wispo-cms-backups/database/wispo-20260920T194114Z.sql.gz` — gzip и SHA-256 проверены.
  Исходники предыдущей версии: `/opt/wispo-cms-releases/wispo-cms-20260920-pre-instagram-youtube`;
  nginx: `/opt/wispo-cms-releases/nginx-20260920-pre-instagram-youtube.conf`.
- Восстановление: возврат API/web и nginx из предрелизной копии; новые таблицы оставить,
  destructive down запрещён. Старый код не поддерживает сбор новых социальных сетей.
- Эксплуатация и ограничения: `docs/instagram-youtube-sources.md`.

### 2026-09-20 · Журнал и правила параллельной работы

- Статус: **Готово, документация**.
- Владелец: задача Артёма / Codex; ветка `feature/content-center-preparation-mvp`.
- Изменено: этот журнал, корневой `AGENTS.md`, ссылка из `deploy/OPERATIONS.md`.
  Перед каждой правкой обязательно сверять журнал и отражать влияние на БД.
- БД — схема/данные: не менялись. Выполнен только SELECT истории миграций.
- Проверки: сведения сопоставлены с Git, файлами 13 миграций, настройкой TypeORM
  и серверной таблицей `migrations`; секреты/клиентские строки не читались.
- Выкладка приложения: не требуется и не выполнялась. Действующий код остаётся
  на `9f169b7`; правила должны попасть в рабочие ветки обоих участников.
- Остаётся: получить журнал/ветку/целевое окружение Романа перед общим слиянием.

### 2026-09-20 · Компактные адреса источников

- Статус: **Выложено**. Владелец: задача Артёма; та же feature-ветка.
- Коммит: `9f169b776aa02b2594ff43f54dc428bf8f00d3a7`.
- Файлы: `apps/web/src/app/content-center/{materials.ts,site-material-fields.tsx,social-material-fields.tsx,project-materials.tsx,content-center-view.tsx,source-registry.tsx}` и три профильных frontend-теста.
- Изменено: отображение адресов без `https://`; ввод без схемы получает HTTPS
  перед сохранением. Полный адрес всё ещё можно вставлять; `href` остаётся HTTPS.
- БД — схема: нет миграций. Данные: прежние строки не переписываются;
  при явном сохранении используется прежний формат полного HTTPS `source_url`.
- Проверки: 34 теста, ESLint/TypeScript, production web build, оба HTTP-монитора,
  IAB проверка полей и ссылки, сверка 481 файла сервера с коммитом.
- Выкладка: общий сервер, обновлён только web; БД/API не перезапускались.
- Восстановление: прежний web-образ `wispo-cms-web:pre-compact-urls-9f169b7`;
  миграции/откат БД не нужны.

### 2026-09-20 · Официальные значки соцсетей

- Статус: **Выложено**. Владелец: задача Артёма; та же feature-ветка.
- Коммит: `deb1dc137d6b52dd4e68adfa23c52f8e8fcfc89c`.
- Файлы: `apps/web/public/icons/social/`, компонент `social-icon.tsx`, список
  материалов, форма выбора сети, стили и тесты; [`social-icons.md`](social-icons.md).
- Изменено: локальные SVG ВКонтакте, Telegram и YouTube в списке/выборе источника.
- БД — схема/данные/формат: без изменений; миграций нет.
- Проверки: 17 frontend-тестов, lint/TypeScript, web build, мониторинг и IAB.
- Выкладка: общий сервер, только web. Восстановление — прежний web-образ;
  операции с БД не нужны.

### 2026-09-20 · Публичный Telegram без бота

- Статус: **Выложено**. Владелец: задача Артёма; та же feature-ветка.
- Коммит: `4038fe78026a65f7464fb89d2d2a6e66f8062a34`.
- Файлы: `apps/api/src/content-center/telegram-source.ts`, интеграция с очередью
  подготовки/сбора и сервисом контент-центра; формы соцсетей/реестр и тесты.
- Изменено: описание и текст публичного канала; до 100 постов за 180 дней,
  до 10 страниц/90 секунд; без репостов, комментариев и чтения вложений.
- БД — схема: миграций нет. Данные/формат: сбор пишет задачи в существующую
  очередь `cc_preparation_runs`, снимки — в существующие поля `cc_materials`;
  JSON источников используется и для соцсетей. Массового backfill нет.
- Совместимость: старый код до Telegram не следует считать способным обновлять
  эти снимки. Полный сбой сохраняет прежний снимок; AI запускается отдельно.
- Проверки: parser/collector и queue unit-тесты, 2 PostgreSQL integration-теста,
  frontend-проверки, API/web build, мониторы, IAB и read-only публичный сбор.
- Ограничение: у `t.me/crazystudio_blog` проверенные посты марта 2025 не входят
  в окно 180 дней на 20.09.2026. Поэтому сохранено только описание.
  Удаление ограничения по давности **не реализовано**.
- Выкладка: общий сервер, API/web. Резервная копия перед релизом:
  `/root/wispo-cms-backups/database/wispo-20260920T161457Z.sql.gz`.
  Откат кода сам по себе не удаляет уже сохранённые снимки.

### 2026-09-20 · VK: общий ключ и упрощённое подключение

- Статус: **Выложено**. Владелец: задача Артёма; та же feature-ветка.
- Коммиты: `c6587f6` — исходный VK-сбор, `b35a20b` — выбор соцсети,
  `b7b7202` — общий ключ, `d313131` — удалён лишний шаг подключения/чекбокс.
- Файлы: VK-сервисы `apps/api/src/content-center/`, настройки платформы,
  формы соцсетей и две VK-миграции из таблицы выше.
- БД — схема: `1790918400000` и `1791004800000`, обе применены.
  Данные: глобальная настройка VK, привязки материалов, очередь и снимки сбора.
  Старые зашифрованные ключи не переносятся в журнал и не удаляются миграцией.
- Проверки: выпуск подтверждён предыдущими проверками; пользователь проверил
  доступ к открытому сообществу и сбор. Повторный API/AI-сбор сейчас не запускался.
- Выкладка: общий сервер. При объединении нельзя терять настройки/привязки;
  удаление таблиц или возврат `NOT NULL` не являются безопасным обычным откатом.

### 2026-09-20 · Дополнительный домен CMS

- Статус: **Выложено**. Владелец: задача Артёма; та же feature-ветка.
- Коммит: `a12d56e8b9991037b8dcc08bec9b74de83cce2db`.
- Изменено: alias `cms.kpbox.ru`, TLS, nginx, разрешённые origin/служебные
  hostnames и эксплуатационная документация. Основной сайт `kpbox.ru` не менялся.
- БД — схема/данные: нет миграций/переноса. Оба адреса используют одну БД.
- Проверки: HTTP/TLS-мониторинг; сессия входа отдельная для каждого hostname.
- Окружение: DNS/TLS и локальная конфигурация сервера не восстанавливаются одним
  переключением Git-ветки. Домен временный; до окончания его использования нужно
  отдельно убрать alias и изменить настройки приложения VK.

### 2026-09-21 · Очередь расшифровки YouTube через Groq Whisper

- Статус: **Выложено**. Владелец: задача Артёма / Codex; ветка `feature/content-center-preparation-mvp`.
- Коммит: `95bee34`.
- Изменено: отдельная настройка Groq Whisper (не DeepSeek и не YouTube Data API), зашифрованное хранение ключа, проверка доступа, очередь по видео YouTube, повторяемые задания, скачивание/разделение аудио через `yt-dlp`/`ffmpeg` и сохранение текста расшифровки у соответствующего видео.
- БД — схема: применена аддитивная миграция `1791177600000-YouTubeTranscriptions.ts`; добавлены `platform_transcription_settings` и `cc_youtube_transcriptions`. Существующие ключи, материалы и версии не переписывались.
- Проверки: API/web build, 71 API suite (440 passed, 63 skipped), targeted ESLint, production Docker build, контейнерные `yt-dlp`/`ffmpeg`, health/compose status, наличие миграции и таблиц на сервере. Browser smoke открыл опубликованный адрес, но текущая сессия не авторизована; экран настроек и тестовый запуск очереди требуют входа администратора.
- Выкладка: общий preview-сервер `cms.kpbox.ru` / `wispo-cms.45.12.74.66.nip.io`, API и web пересобраны; резервная копия БД `/root/wispo-cms-backups/database/wispo-20260921T173429Z.sql.gz`. Старый код сохранён на сервере в `/opt/wispo-cms-pre-95bee34`.

## Перед объединением с работой Романа

### 2026-09-23 · Выкладка объединённого main на preview

- Статус: **Выложено** 23.09.2026, 19:51 МСК. Пользователь явно запросил обновление сервера для проверки под администратором; назначения сотрудников пока не менять.
- Код: merge `c9a421aae1eeb7ca4f4da7aabbd63e875763e16f`, обе истории и адаптер публикации. Цель: существующий preview `cms.kpbox.ru`, не новый хостинг заказчика.
- БД — схема: ожидается 40→46 миграций, ранее проверенных на изолированной копии; applied-миграции не редактируются.
- БД — данные: существующие данные и media сохраняются; роли/siteIds сотрудников не назначаются. Новая логика журнала применяется к будущим публикациям.
- Безопасность: свежие резервные копии БД и media, сохранение исходного каталога и прежних образов; запуск только после сборки. Разрушительный откат БД запрещён.
- Проверки: ранее зелёные тесты/проверка миграций не повторяются без изменения кода; для релиза — Docker-сборка, health, реестр миграций и встроенный Browser.
- Результат: Docker-сборки API/web прошли; оба контейнера healthy, реестр 46 миграций, оба публичных адреса отвечают, штатный мониторинг успешен. У двух employee остались пустые siteIds, права не расширялись.
- Browser после выкладки: вход существующим администратором, сайт Wispo Media → Пользователи, Crazy Studio → Контент-центр — успешно. Сохранённые материалы и пять версий результата отображаются; внешние AI-запуски и публикации при smoke не выполнялись.
- Резервные копии: БД `/root/wispo-cms-backups/database/wispo-20260923T165119Z.sql.gz` (после остановки старого API); media `/root/wispo-cms-backups/media/wispo-media-20260923T164951Z.tar.gz`. Архивы проверены, SHA-256 совпали.
- Восстановление: прежний каталог `/opt/wispo-cms-releases/wispo-cms-20260923-pre-merge-c9a421a`, образы `wispo-cms-api:pre-merge-c9a421a` и `wispo-cms-web:pre-merge-c9a421a`. Откат схемы/дампа автоматически не выполняется. Секреты сохранены без изменений; скриптам резервирования и мониторинга восстановлен executable bit.

### 2026-09-23 · Безопасное объединение веток Артёма и Романа

- Продолжение: согласованные правила реализованы. Администратор Wispo и владелец в пределах сайта публикуют без отдельного согласования; сотрудники сохраняют ограничения своей роли. Общий контент-центр доступен только при охвате всех сайтов workspace либо администратору; сервер и UI используют общую политику. Прямая публикация сотрудниками закрыта. Публикация владельца атомарно сохраняет CMS-ревизию, согласование и событие публикации; существующий черновик не перезаписывается.

- Статус: **Готово, не выложено**; подтверждён merge в main. Владелец: задача Артёма / Codex; ветка `integration/roman-content-center-20260923`.
- Основание: `43fe70e` (`feature/content-center-preparation-mvp`) и `607171f` (`feature/roles-approvals-versioning`); общая база `b700a05`.
- Обе исходные ветки сохраняются. Созданы локальные резервные Git-ссылки `backup/artem-before-roman-20260923` и `backup/roman-before-integration-20260923`; объединение выполняется в отдельном worktree.
- Изменения: интеграция контент-центра, источников и AI с ролями, согласованием и версионностью CMS. Конфликты разрешаются по смыслу, без полной замены файлов одной стороной.
- БД — схема: объединение реестра миграций с шестью миграциями Романа; проверка уникальности и совместимости на изолированной БД обязательна. Данные общей БД и медиа не изменяются; перенос данных между окружениями не выполняется.
- БД — данные и формат: адаптер публикации не добавляет миграций; при будущих публикациях пишет снимки и события в существующий журнал CMS вместе со старой историей, сохраняя прежний публичный снимок как baseline. Назначения пользователей не менялись. Перед выкладкой необходимо явно назначить роль и сайты двум legacy-сотрудникам.
- Проверки: обе production-сборки, 674 API-теста и 2 теста реестра, web contract/helper проверки и точечный lint; изолированный API healthy. Реальные переходы миграций 40→46, 28→46 и bootstrap→46 успешны, значения 53 таблиц сохранены. Исправлен путь production-сборки API после добавления scripts. Детали, ограничения и блокеры: [отчёт интеграции](integration-2026-09-23.md).
- Выкладка: не выполняется. Перенос на хостинг заказчика — отдельный этап после проверки интеграции и резервного копирования.
- Финальные проверки адаптера: 31 unit-тест, 63 интеграционных сценария на отдельной PostgreSQL (60 общим запуском и 3 повторно после обновления fixtures), 158 web-тестов, адресный ESLint, сборки API/web. Browser: вход тестовым администратором, контент-центр и пользователи сайта — успешно на локальной production-сборке с изолированным API. Рабочий сервер не изменён.
- Merge-коммит двух историй: `88b6e6f`; [PR #2](https://github.com/ArtemCrazy/wispocms/pull/2) содержит также последующие исправления совместимости. Исходные ветки и резервные ссылки сохранены.

1. Сверить обе ветки, журналы, общий базовый коммит и фактические окружения/БД.
2. Объединить код и миграции без потери записей; проверить одинаковые номера,
   пересекающиеся таблицы/колонки, порядок и совместимость форматов JSON.
3. На отдельной копии актуальной целевой БД проверить переход к объединённой
   версии. Для разных наборов пользовательских данных определить ключи,
   конфликты и отдельный перенос — не «слить два дампа» поверх рабочей базы.
4. Перед согласованной выкладкой сверить серверный коммит/миграции, сделать
   свежую проверенную резервную копию и зафиксировать результат в журнале.

Работу над независимым интерфейсом можно продолжать. Изменения общей схемы,
конфликтующих данных и параллельную выкладку необходимо согласовывать.
