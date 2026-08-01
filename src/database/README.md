# Database — Schema & Migrations

Postgres schema management. **Migrations are the only way the schema changes** — `synchronize: false` everywhere.

## Policy

- **`synchronize: false`** in both runtime (`app.module.ts`) and CLI (`data-source.ts`). TypeORM's auto-sync would diff entities against the DB and run `ALTER TABLE` on every boot — one bad boot could drop columns. Migrations only.
- **Schema changes flow through `migration:generate`**, which introspects the entities and produces matching DDL:

  ```sh
  npm run migration:generate src/database/migrations/<timestamp>-<Name>
  ```

  The generated file is the source of truth — hand-written DDL drifts from entities.

- **Migrations create schema + seed the admin account, and nothing else.** Zero demo data, zero starter content:
  - Admin user comes from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars.
  - **Fail-fast**: the migration throws if either is missing — no silent anonymous boot.
- `uuid-ossp` is used for UUID generation (available in the Postgres image).

## Behaviour

- The app boots with an empty schema and applies migrations on startup — the schema must exist before anything else runs (the E2E fixture depends on this ordering).
- Non-admin users are created externally (E2E test fixture only — no registration endpoint).
