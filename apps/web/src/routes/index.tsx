import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { InboxPageClient } from "~/features/mailbox/components/inbox-page-client";
import { getSessionUser } from "~/lib/auth.functions";

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(
    z.object({
      mailbox: z.enum(["inbox", "spam", "sent", "trash", "drafts"]).catch("inbox").default("inbox"),
      mailboxId: z.string().trim().min(1).optional().catch(undefined),
      messageId: z.string().trim().min(1).optional().catch(undefined),
      query: z.string().trim().catch("").default(""),
    }),
  ),
  ssr: "data-only",
  loader: async () => {
    const user = await getSessionUser();

    if (!user) {
      throw redirect({
        to: "/home",
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
