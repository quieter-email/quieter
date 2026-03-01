import { db } from "@quietr/database";

export function createTrpcContext(options: { req: Request }) {
  return {
    db,
    req: options.req,
  };
}

export type TrpcContext = ReturnType<typeof createTrpcContext>;
