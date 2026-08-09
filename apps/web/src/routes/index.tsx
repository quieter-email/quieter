import { createFileRoute, redirect } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { LoadingPage } from "#/components/loading-page";
import { MAILBOX_WORKSPACE_VIEWS } from "#/features/mailbox/domain/mailbox-workspace-view";
import { getSessionUser } from "#/lib/auth.functions";

const optionalMinLengthSearchString = () =>
  z.preprocess((value): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length >= 1 ? trimmed : undefined;
  }, z.string().min(1).optional());

const optionalLiteralSearchValue = <T extends string>(literal: T) =>
  z.preprocess(
    (value): T | undefined => (value === literal ? literal : undefined),
    z.literal(literal).optional()
  );

const mailboxSearchCategories = [
  "inbox",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
  "drafts",
  "template",
  "compose",
] as const;

const parseMailboxSearchCategory = (
  value: unknown
): (typeof mailboxSearchCategories)[number] => {
  if (typeof value !== "string") {
    return "inbox";
  }
  for (const category of mailboxSearchCategories) {
    if (value === category) {
      return category;
    }
  }
  return "inbox";
};

const parseMailboxWorkspaceView = (
  value: unknown
): (typeof MAILBOX_WORKSPACE_VIEWS)[number] => {
  if (typeof value !== "string") {
    return "inbox";
  }
  for (const view of MAILBOX_WORKSPACE_VIEWS) {
    if (value === view) {
      return view;
    }
  }
  return "inbox";
};

const mailboxSearchCategory = () =>
  z.preprocess(
    parseMailboxSearchCategory,
    z.enum(mailboxSearchCategories).default("inbox")
  );

const mailboxWorkspaceViewSearch = () =>
  z.preprocess(
    parseMailboxWorkspaceView,
    z.enum(MAILBOX_WORKSPACE_VIEWS).default("inbox")
  );

const searchQueryParam = () =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().default("")
  );

export const Route = createFileRoute("/")({
  loader: async ({ location }) => {
    const user = await getSessionUser();

    if (!user) {
      return redirect({
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
  ssr: "data-only",
  validateSearch: zodValidator(
    z.object({
      chatId: optionalMinLengthSearchString(),
      compose: optionalLiteralSearchValue("mailto"),
      gmailLink: optionalLiteralSearchValue("complete"),
      mailbox: mailboxSearchCategory(),
      mailboxId: optionalMinLengthSearchString(),
      mailto: optionalMinLengthSearchString(),
      messageId: optionalMinLengthSearchString(),
      query: searchQueryParam(),
      threadId: optionalMinLengthSearchString(),
      view: mailboxWorkspaceViewSearch(),
    })
  ),
});

export type MailboxSearch = ReturnType<typeof Route.useSearch>;
