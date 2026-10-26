import { z } from "zod";

import {
  connectorProviderSchema,
  disconnectConnector,
  listConnectors,
  startConnectorOAuth,
} from "../connectors/service";
import { protectedProcedure } from "./base";

export const connectorsRouter = {
  disconnect: protectedProcedure
    .input(
      z.object({
        connectionId: z.string().trim().min(1).optional(),
        provider: connectorProviderSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await disconnectConnector({ ...input, userId: context.userId })
    ),

  list: protectedProcedure
    .route({ method: "GET" })
    .handler(async ({ context }) => await listConnectors(context.userId)),

  startConnection: protectedProcedure
    .input(
      z.object({
        provider: connectorProviderSchema,
        returnTo: z.string().optional(),
      })
    )
    .handler(
      async ({ context, input }) =>
        await startConnectorOAuth({ ...input, userId: context.userId })
    ),
};
