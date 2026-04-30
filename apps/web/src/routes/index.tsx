import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";
import { LoadingPage } from "~/components/loading-page";
import { InboxPageClient } from "~/features/mailbox/components/inbox-page-client";
import { getSessionUser } from "~/lib/auth.functions";

const mailboxCategories = ["inbox", "spam", "sent", "trash", "drafts"] as const;

const mailboxSearchDefaults = {
  mailbox: "inbox",
  query: "",
} as const;

const mailboxSearchSchema = z.object({
  mailbox: z
    .enum(mailboxCategories)
    .catch(mailboxSearchDefaults.mailbox)
    .default(mailboxSearchDefaults.mailbox),
  mailboxId: z.string().trim().min(1).optional().catch(undefined),
  messageId: z.string().trim().min(1).optional().catch(undefined),
  query: z.string().trim().catch(mailboxSearchDefaults.query).default(mailboxSearchDefaults.query),
});

export type MailboxSearch = z.output<typeof mailboxSearchSchema>;

export const Route = createFileRoute("/")({
  validateSearch: zodValidator(mailboxSearchSchema),
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

function InboxRouteComponent() {
  const { user } = Route.useLoaderData();

  return <InboxPageClient user={user} />;
}
