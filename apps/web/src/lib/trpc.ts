import { createTrpcClient } from "@quietr/trpc";

export const trpc = createTrpcClient({
  url: "/api/trpc",
});
