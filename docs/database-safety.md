# Database Safety

Production database access uses two separate Postgres roles:

- The application role can read and write application tables but cannot create, alter, or drop
  schemas or tables.
- The migration role owns the schema and exists only as the `DATABASE_MIGRATION_URL` secret in the
  protected GitHub `production` environment.

Developers receive neither credential. Local development uses local Postgres, and CI migration tests
use the workflow's temporary Postgres service container.

## Production Role Setup

Connect as the existing production owner and create the application role through SQL. Do not create
the role through the Neon Console, API, or CLI, which can assign broader Neon-managed privileges.

```sql
CREATE ROLE quieter_app
  LOGIN
  PASSWORD '<generated-password>'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM quieter_app;

GRANT CONNECT ON DATABASE neondb TO quieter_app;
GRANT USAGE ON SCHEMA public TO quieter_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO quieter_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO quieter_app;

ALTER DEFAULT PRIVILEGES FOR ROLE <migration-role> IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO quieter_app;
ALTER DEFAULT PRIVILEGES FOR ROLE <migration-role> IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO quieter_app;
```

Use the `quieter_app` connection string for Vercel `DATABASE_URL` and application runtime secrets.
Keep the schema-owner connection string only in GitHub's protected production
`DATABASE_MIGRATION_URL` secret. After switching, rotate the previous owner password and remove every
remote database URL from developer machines.

Verify the application role:

```sql
SELECT current_user;
SELECT has_schema_privilege(current_user, 'public', 'CREATE');
```

The second query must return `false`.

## Required Platform Controls

- Mark the Neon production branch as protected.
- Enable the longest affordable restore window and periodically test restoration.
- Restrict protected-branch network access when the Neon plan supports it.
- Keep GitHub `main` protected and production deployments manually approved.
- Never bypass the repository migration guards or add remote database URLs to `.env.local`.
