import { production } from "./stage";
import type { SecretResource } from "./types";

const productionHyperdriveId = "6521686112444b3ca0eaa88e4d1f8b5f";

const parsePostgresOrigin = (connectionString: string) => {
  const url = new URL(connectionString);
  const database = decodeURIComponent(
    url.pathname.replace(/^\//u, "").split("/")[0]?.split("?")[0] || ""
  );

  if (!url.hostname || !url.username || !database) {
    throw new Error(
      "DATABASE_URL must include host, user, and database for Hyperdrive"
    );
  }

  return {
    database,
    host: url.hostname,
    password: decodeURIComponent(url.password),
    port: url.port ? Number(url.port) : 5432,
    user: decodeURIComponent(url.username),
  };
};

export const createAppDatabase = (databaseSecret: SecretResource) => {
  if (production) {
    return sst.cloudflare.Hyperdrive.get("AppDatabaseV2", {
      hyperdriveId: productionHyperdriveId,
    });
  }

  const origin = databaseSecret.value.apply(parsePostgresOrigin);

  return new sst.cloudflare.Hyperdrive("AppDatabaseV2", {
    caching: false,
    origin: {
      database: origin.database,
      host: origin.host,
      password: origin.password,
      port: origin.port,
      scheme: "postgres",
      user: origin.user,
    },
  });
};
