import { assertDatabaseConfigured, db } from "@quietr/database";

export function createTrpcContext(options: { req: Request }) {
  assertDatabaseConfigured();

  return {
    db,
    req: options.req,
    url: new URL(options.req.url),
  };
}

export type TrpcContext = ReturnType<typeof createTrpcContext>;
