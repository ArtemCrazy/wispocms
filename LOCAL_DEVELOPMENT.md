# Local development

The local environment runs entirely in Docker Desktop and does not use the
Node.js or PostgreSQL installations from Windows/OpenServer.

## Start

```powershell
docker compose --env-file .env.local -f compose.local.yaml up -d
```

- CMS: http://localhost:3300
- API health: http://localhost:4300/api/health
- Skinova preview: http://localhost:3300/preview/skinova
- PostgreSQL: `127.0.0.1:5434`
- Redis: `127.0.0.1:6380`

Local administrator credentials are stored only in the ignored `.env.local`
file. Safe development defaults are provided in `.env.local.example`.

## Logs and status

```powershell
docker compose --env-file .env.local -f compose.local.yaml ps
docker compose --env-file .env.local -f compose.local.yaml logs -f api web
```

## Stop

This keeps the local database and uploaded media:

```powershell
docker compose --env-file .env.local -f compose.local.yaml down
```

To recreate the local environment from scratch, remove only its Docker volumes:

```powershell
docker compose --env-file .env.local -f compose.local.yaml down --volumes
docker compose --env-file .env.local -f compose.local.yaml up -d
```

The `--volumes` command permanently deletes local Wispo database and media
data. It does not affect OpenServer or VDS data.

## Production build check

Before preparing a deployment commit, verify the same Dockerfiles used by the
preview deployment:

```powershell
docker build --file apps/api/Dockerfile --tag wispo-cms-api:local-verify .
docker build --file apps/web/Dockerfile --build-arg API_PROXY_URL=http://api:4000 --build-arg WISPO_ASSET_VERSION=local-verify --tag wispo-cms-web:local-verify .
```
