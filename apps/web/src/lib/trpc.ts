import { createTrpcClient, type AppRouter } from "@quietr/trpc";
import { createTRPCContext } from "@trpc/tanstack-react-query";

export const createAppTrpcClient = () =>
  createTrpcClient({
    url: "/api/trpc",
  });

export const trpc = createAppTrpcClient();

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();
