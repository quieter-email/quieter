import { initTRPC } from "@trpc/server";
import type { TrpcContext } from "./context";

const t = initTRPC.context<TrpcContext>().create();

export const appRouter = t.router({});

export type AppRouter = typeof appRouter;
