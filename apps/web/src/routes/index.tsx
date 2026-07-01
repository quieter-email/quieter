import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { InboxPageClient } from "~/features/mailbox/components/inbox-page-client";
import { MAILBOX_WORKSPACE_VIEWS } from "~/features/mailbox/domain/mailbox-workspace-view";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(
    z.object({
      mailbox: z
        .enum(["inbox", "unread", "spam", "sent", "trash", "drafts"])
        .catch("inbox")
        .default("inbox"),
      mailboxId: z.string().trim().min(1).optional().catch(undefined),
      chatId: z.string().trim().min(1).optional().catch(undefined),
      gmailLink: z.literal("complete").optional().catch(undefined),
      compose: z.literal("mailto").optional().catch(undefined),
      mailto: z.string().trim().min(1).optional().catch(undefined),
      messageId: z.string().trim().min(1).optional().catch(undefined),
      threadId: z.string().trim().min(1).optional().catch(undefined),
      query: z.string().trim().catch("").default(""),
      view: z.enum(MAILBOX_WORKSPACE_VIEWS).catch("inbox").default("inbox"),
    }),
  ),
  ssr: "data-only",
  staleTime: Number.POSITIVE_INFINITY,
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        search: {
          returnTo: location.href,
        },
        to: "/auth",
      });
    }

    return {
      user,
    };
  },
  pendingComponent: LoadingPage,
  component: InboxRouteComponent,
});

export type MailboxSearch = ReturnType<typeof Route.useSearch>;

function InboxRouteComponent() {
  const { user } = Route.useLoaderData();

  return <InboxPageClient user={user} />;
}
