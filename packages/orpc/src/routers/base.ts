import { os } from "@orpc/server";
import { getSessionWithOrganization } from "@quieter/auth/session";
import { z } from "zod";

import { getRequestHeaders } from "../context";
import type { OrpcContext } from "../context";
import { orpcErrorMap } from "../errors";

export { mailCategorySchema as mailboxCategorySchema } from "@quieter/mail/data-plane";

export const base = os.errors(orpcErrorMap).$context<OrpcContext>();
export const publicProcedure = base;

export type ProtectedContext = OrpcContext & {
  user: {
    email: string;
    id: string;
    name: string;
  };
  userId: string;
};

export const protectedProcedure = base.use(
  async ({ context, errors, next }) => {
    // Set only by the server adapter after validating a resource-bound token.
    if (context.mcpUser !== undefined) {
      return await next({
        context: {
          ...context,
          user: context.mcpUser,
          userId: context.mcpUser.id,
        },
      });
    }

    const headers = getRequestHeaders(context);
    const sessionStartedAt = performance.now();
    const session = await getSessionWithOrganization(headers);
    context.resHeaders?.append(
      "Server-Timing",
      `session;dur=${(performance.now() - sessionStartedAt).toFixed(1)}`
    );

    if (session?.user === undefined || session.session === undefined) {
      throw errors.UNAUTHORIZED();
    }

    return await next({
      context: {
        ...context,
        user: {
          email: session.user.email,
          id: session.user.id,
          name: session.user.name,
        },
        userId: session.user.id,
      },
    });
  }
);

export const mailboxIdSchema = z.string().trim().min(1);
export const mailboxSwitcherOrderSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)),
  mailboxIdsByGroupId: z.record(
    z.string().trim().min(1),
    z.array(z.string().trim().min(1))
  ),
});
