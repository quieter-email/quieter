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
    const headers = getRequestHeaders(context);
    const session = await getSessionWithOrganization(headers);

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

export const historySyncMailboxCategorySchema = z.enum([
  "inbox",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
]);
export const mailboxIdSchema = z.string().trim().min(1);
export const gmailUserLabelNameSchema = z.string().trim().min(1).max(225);
export const mailboxSwitcherOrderSchema = z.object({
  groupIds: z.array(z.string().trim().min(1)),
  mailboxIdsByGroupId: z.record(
    z.string().trim().min(1),
    z.array(z.string().trim().min(1))
  ),
});
