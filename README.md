# Wispo CMS

Локальный каркас платформы Wispo CMS по ТЗ v1.0.

## Состав

- `apps/web` — интерфейс на Next.js;
- `apps/api` — API на NestJS;
- `compose.yaml` — PostgreSQL и Redis для локальной разработки;
- публикация и nginx на VPS будут добавлены после готовности локального MVP.

## Локальный запуск

1. Скопировать `.env.example` в `.env` и заменить локальные пароли.
2. Запустить инфраструктуру: `docker compose up -d postgres redis`.
3. В отдельных терминалах запустить `pnpm dev:web` и `pnpm dev:api`.
4. Открыть интерфейс: `http://localhost:3000`.
5. Проверить API: `http://localhost:4000/api/health`.

На текущей Windows-машине Docker CLI не установлен, поэтому контейнеры проверяются позже на окружении с Docker. Web и API собираются локально независимо от контейнеров.
