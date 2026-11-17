import {
  correspondentHistoryInputSchema,
  openCorrespondentSourceSchema,
} from "../correspondent-history/contracts";
import {
  listCorrespondentHistory,
  openCorrespondentSource,
} from "../correspondent-history/service";
import { protectedProcedure } from "./base";

export const correspondentHistoryRouter = {
  list: protectedProcedure
    .input(correspondentHistoryInputSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await listCorrespondentHistory({ context, input });
    }),
  openSource: protectedProcedure
    .input(openCorrespondentSourceSchema)
    .handler(async ({ context, input }) => {
      context.resHeaders?.set("Cache-Control", "private, no-store");
      return await openCorrespondentSource({ context, input });
    }),
};
