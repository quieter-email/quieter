const LOCK_TIMEOUT = "5s";
const STATEMENT_TIMEOUT = "5min";

const toDirectPostgresUrl = (value: string) => {
  const url = new URL(value);

  if (url.hostname.includes("-pooler")) {
    url.hostname = url.hostname.replace("-pooler", "");
  }

  url.searchParams.delete("pgbouncer");

  return url;
};

export const getMigrationDatabaseUrl = () => {
  const value = serverEnv.DATABASE_MIGRATION_URL ?? serverEnv.DATABASE_URL;

  if (!value) {
    throw new Error(
      "DATABASE_MIGRATION_URL or DATABASE_URL is required. Local scripts load ../../.env.local — add one of these vars there.",
    );
  }

  const url = toDirectPostgresUrl(value);
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
import { serverEnv } from "@quieter/env/server";
