# Railway Deployments

Tessera deploys as two Railway app services plus managed data services.

## Services

| Service | Railway config | Root directory | Healthcheck |
| --- | --- | --- | --- |
| API | `/apps/api/railway.json` | `/` | `/health/ping` |
| Web | `/apps/web/railway.json` | `/` | `/` |
| Postgres | Railway Postgres plugin | n/a | n/a |
| Redis | Railway Redis plugin | n/a | n/a |
| Git storage | Railway Volume attached to the Git service | n/a | n/a |

Keep both app services rooted at `/`. The build and start commands use root workspace scripts such as `bun run build:api` and `bun run start:web`.

## API Variables

Required for production:

- `DATABASE_URL`
- `REDIS_URL`
- `AUTH_SECRET`
- `APP_URL`
- `API_URL`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- `INTERNAL_API_TOKEN`

Optional:

- `DB_POOL_MAX`
- `DB_IDLE_TIMEOUT_SECONDS`
- `DB_CONNECT_TIMEOUT_SECONDS`
- `DB_SLOW_QUERY_THRESHOLD_MS`
- `CACHE_REDIS_DB`
- `BULL_BOARD_PATH`
- `BULL_BOARD_USERNAME`
- `BULL_BOARD_PASSWORD`
- `SENTRY_DSN`
- `SENTRY_ENVIRONMENT`
- `SENTRY_RELEASE`
- `SENTRY_TRACES_SAMPLE_RATE`

Railway provides:

- `PORT`
- `RAILWAY_GIT_COMMIT_SHA`

## Web Variables

Required for production:

- `API_URL`
- `VITE_API_URL`
- `VITE_APP_URL`

## Deploy Order

1. Create the Railway project.
2. Add Postgres.
3. Add Redis.
4. Create the Git service and attach a Railway Volume for `GIT_STORAGE_ROOT`.
5. Create the API service using `/apps/api/railway.json`.
6. Set API variables, including `DATABASE_URL`, `REDIS_URL`, and `INTERNAL_API_TOKEN`.
7. Set Git service variables, including `GIT_API_AUTHORIZATION_URL` and `GIT_API_AUTHORIZATION_TOKEN`.
8. Deploy API and verify `/health/ping`.
9. Create the Web service using `/apps/web/railway.json`.
10. Set Web variables using the final API, Git HTTP, and Web domains.
11. Deploy Web and verify `/`.

API migrations run during Railway predeploy with `bun run db:migrate`.
