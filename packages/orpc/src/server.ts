import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { createOrpcContext } from "./context";
import { appRouter } from "./router";

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error(error);
    }),
  ],
});

export async function handleOrpcRequest(req: Request, endpoint: `/${string}` = "/api/orpc") {
  const { response } = await handler.handle(req, {
    context: createOrpcContext({ req }),
    prefix: endpoint,
  });

  return response ?? new Response("Not found", { status: 404 });
}

export { appRouter };
