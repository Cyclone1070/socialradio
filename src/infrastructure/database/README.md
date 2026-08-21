# Database — MikroORM Schemas & Migrations

Postgres schema management using **MikroORM** and decoupled migration containers.

## Policy & Architecture

- **Dedicated Migration Container**: Migrations do NOT run inside the application process (`main.ts`). In `docker-compose.yml`, a dedicated `migration` container runs `npm run migration:up` before the application starts up.
- **Strict Schema-Driven Development**: Entities in feature slices are pure POCOs (`*.entity.ts`), while MikroORM schemas live in `src/infrastructure/database/schemas/`.
- **Migration Commands**:
  ```sh
  npm run migration:create    # Generate initial/incremental migration
  npm run migration:up        # Apply pending migrations
  npm run migration:down      # Rollback last migration
  ```
- **Admin Seeding**: The initial migration seeds the admin user using credentials defined in `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables.
- **Fail-Fast**: Bootstrapping throws immediately if database connection or migration execution fails.
