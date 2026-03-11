import { createTrpcContext } from "@quietr/trpc/context";
import { appRouter } from "@quietr/trpc/router";
import { headers } from "next/headers";

const createServerRequest = async () =>
  new Request("http://quietr.local/api/trpc", {
    headers: new Headers(await headers()),
  });

export const createServerTrpcCaller = async () =>
  appRouter.createCaller(createTrpcContext({ req: await createServerRequest() }));
