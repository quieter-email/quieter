const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "5min";

export const getMigrationDatabaseUrl = () => {
  const value = (process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL)?.trim();

  if (!value) {
    throw new Error("DATABASE_MIGRATION_URL or DATABASE_URL is required");
  }

  const url = new URL(value);
  const options = [
    url.searchParams.get("options"),
    `-c lock_timeout=${LOCK_TIMEOUT}`,
    `-c statement_timeout=${STATEMENT_TIMEOUT}`,
  ]
    .filter(Boolean)
    .join(" ");

  url.searchParams.set("options", options);
  return url.toString();
};
