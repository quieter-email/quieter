# Database Safety

Production database access uses two separate Postgres roles:

- The application role can read and write application tables but cannot create, alter, or drop schemas or tables.
- The migration role owns the schema and exists only as the `DATABASE_MIGRATION_URL` secret in the protected GitHub `production` environment.

Developers receive neither production credential. Local development uses loopback Postgres or the exactly allowlisted PlanetScale `quieter_dev` logical database with separate app and migrator roles, and CI migration tests use the workflow's temporary Postgres service container.

## Production Role Setup

Create PlanetScale application and migration roles without inherited cluster-wide data privileges. Use the generated PostgreSQL role identifiers in the grants below. The migration role receives schema creation only in `quieter`; the application role receives only runtime data access.

```sql
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM <application-role>;

GRANT CONNECT, CREATE ON DATABASE quieter TO <migration-role>;
GRANT CREATE, USAGE ON SCHEMA public TO <migration-role>;
GRANT CONNECT ON DATABASE quieter TO <application-role>;
GRANT USAGE ON SCHEMA public TO <application-role>;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO <application-role>;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO <application-role>;

ALTER DEFAULT PRIVILEGES FOR ROLE <migration-role> IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO <application-role>;
ALTER DEFAULT PRIVILEGES FOR ROLE <migration-role> IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO <application-role>;
```

Store the deployed runtime's PlanetScale application-role URL on port 6432 in the SST `DatabaseUrl` secret. Keep the migration role's direct port 5432 connection string only in GitHub's protected production `DATABASE_MIGRATION_URL` secret. After switching, remove every production database URL from developer machines.

Verify the application role:

```sql
SELECT current_user;
SELECT has_schema_privilege(current_user, 'public', 'CREATE');
```

The second query must return `false`.

## Required Platform Controls

- Keep production and development in separate logical databases with cross-database `CONNECT` revoked.
- Keep automatic PlanetScale backups enabled and periodically test restoration.
- Restrict network access when the deployment topology supports stable source addresses.
- Keep GitHub `main` protected and production deployments manually approved.
- Never bypass the repository migration guards. A remote URL in `.env.local` must target only `quieter_dev` on the exact host pinned by `QUIETER_LOCAL_PLANETSCALE_HOST`.
