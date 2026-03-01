import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createTrpcContext } from "./context";
import { appRouter } from "./router";

export function handleTrpcRequest(req: Request, endpoint = "/api/trpc") {
  return fetchRequestHandler({
    endpoint,
    req,
    router: appRouter,
    createContext: () => createTrpcContext({ req }),
  });
}

export { appRouter };
