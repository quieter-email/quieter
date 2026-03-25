import { assertDatabaseConfigured, db } from "@quietr/database";

export function createOrpcContext(options: { req: Request }) {
  assertDatabaseConfigured();

  return {
    db,
    req: options.req,
    url: new URL(options.req.url),
  };
}

export type OrpcContext = ReturnType<typeof createOrpcContext>;
