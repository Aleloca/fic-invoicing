# Contributing

Thanks for helping. Keep changes small and focused.

## Setup

```bash
nvm use            # Node 24
npm ci
cp .env.example .env   # fill in the secrets
docker compose up -d db
npx prisma migrate deploy
npm run dev
```

## Before opening a pull request

```bash
npm run lint
npm run typecheck
TEST_DATABASE_URL="mysql://root:change-me-root@127.0.0.1:3307/fic_invoicing_test" npm test
npm run build
```

Without `TEST_DATABASE_URL` the integration tests (API, idempotency, token refresh) are skipped.
The test database is wiped, so its name must contain `test`. Apply migrations to it first:
`DATABASE_URL=$TEST_DATABASE_URL npx prisma migrate deploy`.

## Rules

- Never call the real Fatture in Cloud API from tests: stub `fetch` (see `tests/helpers/fic-mock.ts`).
- Schema changes need a migration in `prisma/migrations` (`npx prisma migrate dev --name <change>`).
- Do not commit real company ids, tokens, customer data or secrets.
- Fiscal wording changes need a source (law article, Agenzia delle Entrate guidance) in the PR description.
