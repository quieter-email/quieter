import { z } from "zod";

import { MAILBOX_WORKSPACE_VIEWS } from "./features/mailbox/domain/mailbox-workspace-view";
import { ORGANIZATION_SETTINGS_VIEWS } from "./features/settings/domain/organization-settings-view";
import { SETTINGS_TABS } from "./features/settings/domain/settings-tab";
import { getSafeAuthReturnTo } from "./lib/return-to";

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
  "snippets",
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
): (typeof MAILBOX_WORKSPACE_VIEWS)[number] | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  for (const view of MAILBOX_WORKSPACE_VIEWS) {
    if (value === view) {
      return view;
    }
  }
  return undefined;
};

const mailboxSearchCategory = () =>
  z.preprocess(
    parseMailboxSearchCategory,
    z.enum(mailboxSearchCategories).default("inbox")
  );

const mailboxWorkspaceViewSearch = () =>
  z.preprocess(
    parseMailboxWorkspaceView,
    z.enum(MAILBOX_WORKSPACE_VIEWS).optional()
  );

const searchQueryParam = () =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string().default("")
  );

export const mailboxSearchSchema = z.object({
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
});

export const settingsSearchSchema = z.object({
  billing: z.enum(["canceled", "success"]).optional(),
  checkoutId: z.uuid().optional(),
  connector: z.enum(["connected", "error"]).optional(),
  domainConnect: z
    .enum(["canceled", "error", "needs_dns", "verified"])
    .optional(),
  domainId: z.string().trim().catch("").default(""),
  from: z
    .string()
    .trim()
    .transform((value) =>
      value && value.startsWith("/") && !value.startsWith("//") ? value : "/"
    )
    .catch("/")
    .default("/"),
  gmail: z.enum(["connected", "error"]).optional(),
  mailboxId: z.string().trim().catch("").default(""),
  mailboxView: z.enum(["add", "list"]).catch("list").default("list"),
  organizationId: z.string().trim().catch("").default(""),
  organizationView: z
    .string()
    .trim()
    .pipe(z.enum(ORGANIZATION_SETTINGS_VIEWS))
    .catch("overview")
    .default("overview"),
  section: z.string().trim().catch("").default(""),
  tab: z
    .string()
    .trim()
    .pipe(z.enum(SETTINGS_TABS))
    .catch("overview")
    .default("overview"),
});

export const onboardingSearchSchema = z.object({
  gmailLink: z.union([z.literal("complete"), z.literal("start")]).optional(),
  // Flow state lives in the URL so a round trip through Google or a
  // reload resumes where the person left off.
  intents: z.string().optional(),
  returnTo: z
    .string()
    .optional()
    .transform((returnTo) => getSafeAuthReturnTo(returnTo)),
  step: z.coerce.number().int().min(1).max(2).optional(),
});
