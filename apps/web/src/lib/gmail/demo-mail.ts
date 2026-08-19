import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { QueryClient } from "@tanstack/react-query";

import { clientEnv } from "#/env";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { parseStructuredSearchQuery } from "#/features/message-search/state/message-list-search-state";
import { delay } from "#/lib/delay";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";

import {
  addUnreadLabel,
  applyLabelIdChanges,
  isMessageUnread,
  isMessageInMailbox,
  MAILBOX_LABELS,
  removeUnreadLabel,
} from "./gmail";
import type {
  GmailLabelListItem,
  ListMessagesPageResult,
  MailboxCategory,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "./gmail";
import type { ThreadListEntry } from "./thread-list";
import { getMailboxThreadQueriesKey } from "./thread-query-keys";

export const DEMO_MAILBOX_ID = "demo:mailbox";
export const LANDING_DEMO_MAILBOX_ID = "landing:mailbox";

const DEMO_EMAIL_ADDRESS = "inbox@quieter.com";

const DEMO_MAIL_STORAGE_KEY = "quieter:demo-mail-state";
const DEMO_MAIL_STATE_VERSION = 5;

type DemoMailState = {
  version: number;
  messages: MessageListItem[];
};

let landingDemoState: DemoMailState | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const attachment = (
  fileName: string,
  mimeType: string,
  size: number,
  id = fileName
) => ({
  attachmentId: `demo-attachment-${id}`,
  fileName,
  mimeType,
  size,
});

const getDemoSenderAvatarUrls = (
  from: string | undefined
): { dark: string; light: string } | undefined => {
  if (from === undefined || from === "") {
    return undefined;
  }
  const match =
    /(?<email>[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?<domain>[a-z0-9-]+(?:\.[a-z0-9-]+)+))/iu.exec(
      from
    );
  const domain = match?.groups?.domain?.toLowerCase();
  if (domain === undefined || domain === "") {
    return undefined;
  }
  const token = clientEnv.VITE_LOGO_DEV_PUBLISHABLE_KEY;
  if (token === undefined || token === "") {
    return undefined;
  }
  return {
    dark: `https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=64&theme=dark&format=webp&fallback=404`,
    light: `https://img.logo.dev/${encodeURIComponent(domain)}?token=${token}&size=64&theme=light&format=webp&fallback=404`,
  };
};

const createMessage = (
  id: string,
  fields: Omit<
    MessageListItem,
    "id" | "threadId" | "messageHeaderId" | "internalDate"
  > & {
    threadId?: string;
  }
): MessageListItem => ({
  id,
  internalDate: fields.date ?? daysAgo(0),
  messageHeaderId: `<${id}@demo.quieter.local>`,
  senderAvatarUrls:
    fields.senderAvatarUrls ?? getDemoSenderAvatarUrls(fields.from),
  threadId: fields.threadId ?? id,
  ...fields,
});

const createInitialDemoState = (): DemoMailState => ({
  messages: [
    createMessage("demo-stripe-1", {
      attachments: [attachment("april-payouts.csv", "text/csv", 184_320)],
      bodyHtml:
        "<p>Your April payout reconciliation is ready.</p><p>There are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.</p>",
      bodyText:
        "Your April payout reconciliation is ready.\n\nThere are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.",
      date: daysAgo(0.08),
      from: "Stripe <notifications@stripe.com>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Finance"],
      snippet:
        "Your April payout reconciliation is ready. There are two failed transfers that need review before the end of the week.",
      subject: "April payout reconciliation",
      threadAttachmentCount: 1,
      threadMessageCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-github-1", {
      attachments: [attachment("ci-failure-log.txt", "text/plain", 42_880)],
      bodyHtml:
        "<p>The workflow <strong>web / typecheck</strong> failed on pull request #184.</p><p>The failing package is <code>@quieter/web</code>. The attached log includes the full compiler output.</p>",
      bodyText:
        "The workflow web / typecheck failed on pull request #184.\n\nThe failing package is @quieter/web. The attached log includes the full compiler output.",
      date: daysAgo(0.2),
      from: "GitHub <notifications@github.com>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Product"],
      snippet:
        "The workflow web / typecheck failed on pull request #184. The failing package is @quieter/web.",
      subject: "[quieter] web / typecheck failed",
      threadAttachmentCount: 1,
      threadMessageCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-linear-1", {
      bodyHtml:
        "<p>Alex mentioned you in <strong>QTR-312 Demo mode fixture coverage</strong>.</p><p>Can we include at least one threaded conversation, a couple of attachments, and a sent reply so the walkthrough feels realistic?</p>",
      bodyText:
        "Alex mentioned you in QTR-312 Demo mode fixture coverage.\n\nCan we include at least one threaded conversation, a couple of attachments, and a sent reply so the walkthrough feels realistic?",
      date: daysAgo(0.34),
      from: "Linear <notifications@linear.app>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Product"],
      snippet:
        "Alex mentioned you in QTR-312 Demo mode fixture coverage. Can we include at least one threaded conversation?",
      subject: "Mentioned in QTR-312 Demo mode fixture coverage",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-thread-notion-1", {
      bodyHtml:
        "<p>Hi everyone,</p><p>I drafted the customer onboarding checklist in Notion. The sections that still need owner names are highlighted in yellow.</p>",
      bodyText:
        "Hi everyone,\n\nI drafted the customer onboarding checklist in Notion. The sections that still need owner names are highlighted in yellow.",
      date: daysAgo(0.92),
      from: "Mara Quill <mara@notion.so>",
      labelIds: [MAILBOX_LABELS.inbox],
      snippet:
        "I drafted the customer onboarding checklist in Notion. The sections that still need owner names are highlighted.",
      subject: "Onboarding checklist draft",
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: `Quieter <${DEMO_EMAIL_ADDRESS}>, Theo Byte <theo@figma.com>`,
    }),
    createMessage("demo-thread-notion-2", {
      bodyHtml:
        "<p>Looks good. I added the lifecycle emails and moved the workspace invite step earlier.</p><p>Theo, can you check the screenshots before we share it?</p>",
      bodyText:
        "Looks good. I added the lifecycle emails and moved the workspace invite step earlier.\n\nTheo, can you check the screenshots before we share it?",
      date: daysAgo(0.75),
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.sent],
      snippet:
        "Looks good. I added the lifecycle emails and moved the workspace invite step earlier.",
      subject: "Re: Onboarding checklist draft",
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: "Mara Quill <mara@notion.so>, Theo Byte <theo@figma.com>",
    }),
    createMessage("demo-thread-notion-3", {
      attachments: [
        attachment("onboarding-screenshots.zip", "application/zip", 3_900_000),
      ],
      bodyHtml:
        "<p>I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.</p>",
      bodyText:
        "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
      date: daysAgo(0.58),
      from: "Theo Byte <theo@figma.com>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Product"],
      snippet:
        "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
      subject: "Re: Onboarding checklist draft",
      threadAttachmentCount: 1,
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-deploy-1", {
      bodyHtml:
        "<p>Your preview deployment is ready.</p><p><strong>quieter-web-git-demo-mode</strong> built successfully and is available for review.</p>",
      bodyText:
        "Your preview deployment is ready.\n\nquieter-web-git-demo-mode built successfully and is available for review.",
      date: daysAgo(1.16),
      from: "Vercel <notifications@vercel.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Product"],
      snippet:
        "Your preview deployment is ready. quieter-web-git-demo-mode built successfully and is available for review.",
      subject: "Preview deployment ready",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-slack-1", {
      bodyHtml:
        "<p>You have 4 unread mentions in <strong>#product</strong>.</p><p>The most recent thread is about the new mailbox switcher behavior.</p>",
      bodyText:
        "You have 4 unread mentions in #product.\n\nThe most recent thread is about the new mailbox switcher behavior.",
      date: daysAgo(1.8),
      from: "Slack <notifications@slack.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      snippet:
        "You have 4 unread mentions in #product. The most recent thread is about the new mailbox switcher behavior.",
      subject: "New mentions in #product",
      to: DEMO_EMAIL_ADDRESS,
      unsubscribeMailto: "mailto:unsubscribe@slack.com?subject=unsubscribe",
    }),
    createMessage("demo-openai-1", {
      attachments: [
        attachment("usage-summary.pdf", "application/pdf", 612_400),
      ],
      bodyHtml:
        "<p>Your weekly usage summary is attached.</p><p>Token volume increased 18% week over week, mostly from background classification jobs.</p>",
      bodyText:
        "Your weekly usage summary is attached.\n\nToken volume increased 18% week over week, mostly from background classification jobs.",
      date: daysAgo(2.25),
      from: "OpenAI <support@openai.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Finance"],
      snippet:
        "Your weekly usage summary is attached. Token volume increased 18% week over week.",
      subject: "Weekly usage summary",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-shopify-1", {
      bodyHtml:
        "<p>The Quieter swag test order shipped today.</p><p>Tracking usually appears within 24 hours after the carrier scan.</p>",
      bodyText:
        "The Quieter swag test order shipped today.\n\nTracking usually appears within 24 hours after the carrier scan.",
      date: daysAgo(2.9),
      from: "Shopify <orders@shopify.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      snippet:
        "The Quieter swag test order shipped today. Tracking usually appears within 24 hours.",
      subject: "Your test order shipped",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-airtable-1", {
      attachments: [
        attachment(
          "research-export.xlsx",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          1_240_000
        ),
      ],
      bodyHtml:
        "<p>Here is the latest research export from Airtable. I filtered it down to accounts with active pilot conversations.</p>",
      bodyText:
        "Here is the latest research export from Airtable. I filtered it down to accounts with active pilot conversations.",
      date: daysAgo(3.3),
      from: "Nova Reed <nova@airtable.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Clients"],
      snippet:
        "Here is the latest research export from Airtable. I filtered it down to active pilot conversations.",
      subject: "Pilot account research export",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-dropbox-1", {
      bodyHtml:
        "<p>Milo shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and customer quote approvals.</p>",
      bodyText:
        "Milo shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and customer quote approvals.",
      date: daysAgo(4.1),
      from: "Dropbox <no-reply@dropbox.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      snippet:
        "Milo shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and approvals.",
      subject: "Q2 launch folder shared with you",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-zoom-1", {
      attachments: [
        attachment("customer-call-transcript.vtt", "text/vtt", 98_500),
      ],
      bodyHtml:
        "<p>Your call recording is ready.</p><p>The transcript includes action items from the customer call with Rabbit Hole Labs.</p>",
      bodyText:
        "Your call recording is ready.\n\nThe transcript includes action items from the customer call with Rabbit Hole Labs.",
      date: daysAgo(4.7),
      from: "Zoom <no-reply@zoom.us>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Clients"],
      snippet:
        "Your cloud recording is ready. The transcript includes action items from the customer call.",
      subject: "Call recording: Rabbit Hole Labs sync",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-anthropic-1", {
      bodyHtml:
        "<p>Your workspace security report is ready. No high severity issues were detected in the last 7 days.</p>",
      bodyText:
        "Your workspace security report is ready. No high severity issues were detected in the last 7 days.",
      date: daysAgo(5.2),
      from: "Anthropic <notifications@anthropic.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      snippet:
        "Your workspace security report is ready. No high severity issues were detected in the last 7 days.",
      subject: "Workspace security report",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-draft-1", {
      bodyHtml:
        "<p>Here is the rough plan for the onboarding cleanup. I still need to verify the settings copy before sending.</p>",
      bodyText:
        "Here is the rough plan for the onboarding cleanup. I still need to verify the settings copy before sending.",
      date: daysAgo(0.04),
      draftId: "demo-draft-1",
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.drafts],
      snippet:
        "Here is the rough plan for the onboarding cleanup. I still need to verify the settings copy before sending.",
      subject: "Onboarding cleanup plan",
      to: "Pippa Parker <pippa@figma.com>",
    }),
    createMessage("demo-draft-2", {
      bodyHtml:
        "<p>Thanks for sending the export. I am checking the account notes now and will follow up with the three records that need cleanup.</p>",
      bodyText:
        "Thanks for sending the export. I am checking the account notes now and will follow up with the three records that need cleanup.",
      date: daysAgo(0.12),
      draftId: "demo-draft-2",
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.drafts],
      snippet:
        "Thanks for sending the export. I am checking the account notes now and will follow up with the three records.",
      subject: "Re: Pilot account research export",
      to: "Nova Reed <nova@airtable.com>",
    }),
    createMessage("demo-sent-1", {
      bodyHtml:
        "<p>Thanks, I pushed the final assets into the shared folder and noted the two places that still need legal copy.</p>",
      bodyText:
        "Thanks, I pushed the final assets into the shared folder and noted the two places that still need legal copy.",
      date: daysAgo(0.8),
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.sent],
      snippet:
        "Thanks, I pushed the final assets into the shared folder and noted the two places that still need legal copy.",
      subject: "Re: Launch checklist",
      to: "Milo Stack <milo@resend.com>",
    }),
    createMessage("demo-sent-2", {
      attachments: [attachment("demo-mode-notes.md", "text/markdown", 18_200)],
      bodyHtml:
        "<p>I attached notes from the demo-mode walkthrough. The main gap is richer fixture data for mixed personal and company conversations.</p>",
      bodyText:
        "I attached notes from the demo-mode walkthrough. The main gap is richer fixture data for mixed personal and company conversations.",
      date: daysAgo(1.4),
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.sent],
      snippet:
        "I attached notes from the demo-mode walkthrough. The main gap is richer fixture data.",
      subject: "Demo-mode walkthrough notes",
      threadAttachmentCount: 1,
      to: "Alex Byte <alex@github.com>",
    }),
    createMessage("demo-spam-1", {
      bodyHtml:
        "<p>Congratulations, your account has been selected for a limited reward.</p>",
      bodyText:
        "Congratulations, your account has been selected for a limited reward.",
      date: daysAgo(5.6),
      from: "Special Rewards <promotions@rewards-club.com>",
      labelIds: [MAILBOX_LABELS.spam],
      snippet:
        "Congratulations, your account has been selected for a limited reward.",
      subject: "Limited reward available",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-spam-2", {
      bodyHtml:
        "<p>Your file transfer is waiting. Open the secure portal to prevent expiration.</p>",
      bodyText:
        "Your file transfer is waiting. Open the secure portal to prevent expiration.",
      date: daysAgo(6.8),
      from: "Secure Transfer <notice@file-delivery-portal.net>",
      labelIds: [MAILBOX_LABELS.spam],
      snippet:
        "Your file transfer is waiting. Open the secure portal to prevent expiration.",
      subject: "Action required: file transfer expires soon",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-trash-1", {
      bodyHtml:
        "<p>Can we move the old staging notes out of the main workspace?</p>",
      bodyText: "Can we move the old staging notes out of the main workspace?",
      date: daysAgo(7.3),
      from: "Old Notes <notes@dev-notes.internal>",
      labelIds: [MAILBOX_LABELS.trash],
      snippet: "Can we move the old staging notes out of the main workspace?",
      subject: "Old staging notes",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-trash-2", {
      attachments: [
        attachment("legacy-import.json", "application/json", 264_000),
      ],
      bodyHtml:
        "<p>The legacy import sample is attached. We can delete this once the parser tests are updated.</p>",
      bodyText:
        "The legacy import sample is attached. We can delete this once the parser tests are updated.",
      date: daysAgo(8.9),
      from: "Build Monitor <alerts@ci-status.internal>",
      labelIds: [MAILBOX_LABELS.trash],
      snippet:
        "The legacy import sample is attached. We can delete this once the parser tests are updated.",
      subject: "Legacy import sample",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
  ],
  version: DEMO_MAIL_STATE_VERSION,
});

export const resetLandingDemoMail = () => {
  landingDemoState = createInitialDemoState();
};

const isDemoMailState = (value: unknown): value is DemoMailState => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === DEMO_MAIL_STATE_VERSION && Array.isArray(value.messages)
  );
};

const readDemoState = (): DemoMailState => {
  if (typeof window === "undefined") {
    return createInitialDemoState();
  }

  const raw = window.localStorage.getItem(DEMO_MAIL_STORAGE_KEY);
  if ((raw ?? "") === "") {
    return createInitialDemoState();
  }

  try {
    const parsed: unknown = JSON.parse(raw ?? "");
    if (isDemoMailState(parsed)) {
      return parsed;
    }
    return createInitialDemoState();
  } catch {
    return createInitialDemoState();
  }
};

const writeDemoState = (state: DemoMailState) => {
  window.localStorage.setItem(DEMO_MAIL_STORAGE_KEY, JSON.stringify(state));
};

const readLandingDemoState = (): DemoMailState => {
  landingDemoState ??= createInitialDemoState();

  return landingDemoState;
};

const readSandboxState = (mailboxId: string): DemoMailState => {
  if (mailboxId === LANDING_DEMO_MAILBOX_ID) {
    return readLandingDemoState();
  }

  return readDemoState();
};

const writeSandboxState = (mailboxId: string, state: DemoMailState) => {
  if (mailboxId === LANDING_DEMO_MAILBOX_ID) {
    landingDemoState = state;
    return;
  }

  writeDemoState(state);
};

const updateDemoState = (updater: (state: DemoMailState) => DemoMailState) => {
  writeDemoState(updater(readDemoState()));
};

const updateSandboxState = (
  mailboxId: string,
  updater: (state: DemoMailState) => DemoMailState
) => {
  writeSandboxState(mailboxId, updater(readSandboxState(mailboxId)));
};

const invalidateSandboxMail = async (
  queryClient: QueryClient,
  mailboxId: string
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] }),
    queryClient.invalidateQueries({
      queryKey: getMailboxThreadQueriesKey(mailboxId),
    }),
    ...(mailboxId === DEMO_MAILBOX_ID
      ? [queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() })]
      : []),
  ]);
};

const getSortedMessages = (mailboxId: string) =>
  readSandboxState(mailboxId).messages.toSorted(
    (left, right) =>
      Number(new Date(right.internalDate ?? right.date ?? 0)) -
      Number(new Date(left.internalDate ?? left.date ?? 0))
  );

const textMatchesQuery = (value: string | null | undefined, query: string) =>
  value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false;

const parseRelativeSearchDuration = (value: string) => {
  const match = /^(?<amount>\d+)(?<unit>[dmy])$/u.exec(
    value.trim().toLocaleLowerCase()
  );
  if (match?.groups === undefined) {
    return null;
  }

  const amount = Number(match.groups.amount);
  if (!Number.isFinite(amount)) {
    return null;
  }

  const { unit } = match.groups;
  let days = amount;
  if (unit === "m") {
    days = amount * 30;
  } else if (unit === "y") {
    days = amount * 365;
  }
  return days * 24 * 60 * 60 * 1000;
};

const getMessageTime = (message: MessageListItem) =>
  new Date(message.internalDate ?? message.date ?? 0).getTime();

const messageMatchesDateFilter = (
  message: MessageListItem,
  filter: { type: "after" | "before"; value: string }
): boolean => {
  const filterTime = new Date(filter.value).getTime();
  if (Number.isNaN(filterTime)) {
    return false;
  }

  const messageTime = getMessageTime(message);
  if (filter.type === "after" && messageTime <= filterTime) {
    return false;
  }
  if (filter.type === "before" && messageTime >= filterTime) {
    return false;
  }
  return true;
};

const messageMatchesRelativeDateFilter = (
  message: MessageListItem,
  filter: { type: "older_than" | "newer_than"; value: string }
): boolean => {
  const duration = parseRelativeSearchDuration(filter.value);
  if (duration === null) {
    return false;
  }

  const isOlder = Date.now() - getMessageTime(message) > duration;
  if (filter.type === "older_than" && !isOlder) {
    return false;
  }
  if (filter.type === "newer_than" && isOlder) {
    return false;
  }
  return true;
};

const messageMatchesStructuredFilter = (
  message: MessageListItem,
  filter: ReturnType<typeof parseStructuredSearchQuery>["filters"][number]
): boolean => {
  if (filter.type === "after") {
    return messageMatchesDateFilter(message, {
      type: "after",
      value: filter.value,
    });
  }
  if (filter.type === "before") {
    return messageMatchesDateFilter(message, {
      type: "before",
      value: filter.value,
    });
  }

  if (filter.type === "older_than") {
    return messageMatchesRelativeDateFilter(message, {
      type: "older_than",
      value: filter.value,
    });
  }
  if (filter.type === "newer_than") {
    return messageMatchesRelativeDateFilter(message, {
      type: "newer_than",
      value: filter.value,
    });
  }

  if (filter.type === "has") {
    return (message.attachments?.length ?? 0) > 0;
  }

  if (filter.type === "is") {
    const unread = isMessageUnread(message);
    if (filter.value === "unread") {
      return unread;
    }
    return !unread;
  }

  if (filter.type === "label") {
    const labelId = `Label_${filter.value ?? ""}`;
    return (
      message.labelIds?.some(
        (id) => id.toLocaleLowerCase() === labelId.toLocaleLowerCase()
      ) ?? false
    );
  }

  const filterTargets: Partial<Record<string, (string | null | undefined)[]>> =
    {
      bcc: [message.bcc],
      cc: [message.cc],
      content: [message.bodyText, message.snippet],
      filename:
        message.attachments?.map((fileEntry) => fileEntry.fileName) ?? [],
      from: [message.from],
      subject: [message.subject],
      to: [message.to],
    };
  const targets = filterTargets[filter.type];
  if (targets === undefined) {
    return true;
  }
  return targets.some((target) => textMatchesQuery(target, filter.value ?? ""));
};

const messageMatchesQuery = (
  message: MessageListItem,
  query: string | undefined
) => {
  if ((query ?? "") === "") {
    return true;
  }

  const structuredQuery = parseStructuredSearchQuery(query ?? "");
  for (const filter of structuredQuery.filters) {
    if (!messageMatchesStructuredFilter(message, filter)) {
      return false;
    }
  }

  if ((structuredQuery.text ?? "") === "") {
    return true;
  }

  const haystack = [
    message.subject,
    message.from,
    message.to,
    message.snippet,
    message.bodyText,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes((structuredQuery.text ?? "").toLowerCase());
};

const getUnreadNonSpamCount = (mailboxId: string) =>
  readSandboxState(mailboxId).messages.filter(
    (message) =>
      isMessageUnread(message) &&
      message.labelIds?.includes(MAILBOX_LABELS.spam) !== true &&
      message.labelIds?.includes(MAILBOX_LABELS.trash) !== true
  ).length;

export const getDemoMailboxes = () => ({
  defaultMailboxId: DEMO_MAILBOX_ID,
  groups: [
    {
      id: "demo-team",
      kind: "organization" as const,
      mailboxes: [
        {
          autoLabelEnabled: false,
          capabilities: getMailboxCapabilities({ provider: "gmail" }),
          connectionStatus: "connected" as const,
          displayName: "Demo Mailbox",
          emailAddress: DEMO_EMAIL_ADDRESS,
          grantRole: null,
          groupId: "demo-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: DEMO_MAILBOX_ID,
          organizationId: "demo-team",
          ownerUserId: "demo-user",
          provider: "gmail" as const,
          unreadNonSpamCount: getUnreadNonSpamCount(DEMO_MAILBOX_ID),
          usefulDetailsEnabled: false,
        },
      ],
      name: "Demo",
      slug: "demo-team",
    },
  ],
});

export const getLandingDemoMailboxes = () => ({
  defaultMailboxId: LANDING_DEMO_MAILBOX_ID,
  groups: [
    {
      id: "landing-demo-team",
      kind: "organization" as const,
      mailboxes: [
        {
          autoLabelEnabled: false,
          capabilities: getMailboxCapabilities({ provider: "gmail" }),
          connectionStatus: "connected" as const,
          displayName: "Demo Mailbox",
          emailAddress: DEMO_EMAIL_ADDRESS,
          grantRole: null,
          groupId: "landing-demo-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: LANDING_DEMO_MAILBOX_ID,
          organizationId: "landing-demo-team",
          ownerUserId: "landing-demo-user",
          provider: "gmail" as const,
          unreadNonSpamCount: getUnreadNonSpamCount(LANDING_DEMO_MAILBOX_ID),
          usefulDetailsEnabled: false,
        },
      ],
      name: "Demo",
      slug: "landing-demo-team",
    },
  ],
});

export const listDemoMessages = ({
  mailboxId = DEMO_MAILBOX_ID,
  category,
  maxResults = 50,
  pageToken,
  query,
}: {
  mailboxId?: string;
  category: MailboxCategory;
  maxResults?: number;
  pageToken?: string;
  query?: string;
}): ListMessagesPageResult => {
  const start = (pageToken ?? "") === "" ? 0 : Number(pageToken) || 0;
  const allMessages = getSortedMessages(mailboxId);
  const threadLabelIdsById = new Map<string, Set<string>>();
  for (const message of allMessages) {
    const labelIds =
      threadLabelIdsById.get(message.threadId) ?? new Set<string>();
    for (const labelId of message.labelIds ?? []) {
      labelIds.add(labelId);
    }
    threadLabelIdsById.set(message.threadId, labelIds);
  }
  const messages = allMessages.filter(
    (message) =>
      isMessageInMailbox(message, category) &&
      messageMatchesQuery(message, query)
  );
  const page = messages.slice(start, start + maxResults).map((message) => {
    const threadLabelIds = threadLabelIdsById.get(message.threadId);
    return {
      ...message,
      threadLabelIds: threadLabelIds ? [...threadLabelIds] : undefined,
    };
  });
  const nextOffset = start + maxResults;

  return {
    historyId: "demo-history",
    messages: page,
    nextPageToken:
      nextOffset < messages.length ? String(nextOffset) : undefined,
    resultSizeEstimate: messages.length,
  };
};

export const getDemoThread = (
  mailboxId: string,
  threadId: string
): ThreadMessagesResult => {
  const messages = getSortedMessages(mailboxId).filter(
    (message) => message.threadId === threadId
  );
  const threadLabelIds = [
    ...new Set(messages.flatMap((message) => message.labelIds ?? [])),
  ];

  return {
    messages: messages.map((message) => ({ ...message, threadLabelIds })),
    snippet: messages[0]?.snippet,
    subject: messages[0]?.subject,
    threadId,
  };
};

export const getDemoLabels = (): (GmailLabelListItem & {
  color?: MailboxLabelColor | null;
  description: string | null;
  inclusionCriteria: string | null;
})[] => [
  {
    color: "cyan",
    description: "Client conversations and account activity.",
    id: "Label_Clients",
    inclusionCriteria:
      "Messages from clients about active work, requests, and account updates.",
    name: "Clients",
    type: "user",
  },
  {
    color: "green",
    description: "Invoices, payouts, and billing statements.",
    id: "Label_Finance",
    inclusionCriteria:
      "Payout reconciliations, invoices, and accounting summaries.",
    name: "Finance",
    type: "user",
  },
  {
    color: "purple",
    description: "Product planning, feedback, and release work.",
    id: "Label_Product",
    inclusionCriteria:
      "Product feedback, feature discussions, bug reports, and release updates.",
    name: "Product",
    type: "user",
  },
];

export const getDemoMessageInspector = (
  mailboxId: string,
  messageId: string
): MessageInspectorResult => {
  const message = readSandboxState(mailboxId).messages.find(
    (entry) => entry.id === messageId
  );

  return {
    date: message?.date,
    from: message?.from,
    headers: [
      { name: "From", value: message?.from ?? "" },
      { name: "To", value: message?.to ?? "" },
      { name: "Subject", value: message?.subject ?? "" },
    ],
    id: messageId,
    messageHeaderId: message?.messageHeaderId,
    rawText: "Demo mode message source is local fixture data.",
    snippet: message?.snippet,
    subject: message?.subject,
    to: message?.to,
  };
};

const updateMessages = (
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean,
  update: (message: MessageListItem) => MessageListItem
) => {
  updateSandboxState(mailboxId, (state) => ({
    ...state,
    messages: state.messages.map((message) =>
      predicate(message) ? update(message) : message
    ),
  }));
};

const removeMessages = (
  mailboxId: string,
  predicate: (message: MessageListItem) => boolean
) => {
  updateSandboxState(mailboxId, (state) => ({
    ...state,
    messages: state.messages.filter((message) => !predicate(message)),
  }));
};

const getThreadIdForItem = (mailboxId: string, itemId: string) =>
  readSandboxState(mailboxId).messages.find((message) => message.id === itemId)
    ?.threadId ?? itemId;

const markDemoThreadReadState = async (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string,
  unread: boolean
) => {
  updateMessages(
    mailboxId,
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      isUnread: unread,
      labelIds: unread
        ? addUnreadLabel(message.labelIds)
        : removeUnreadLabel(message.labelIds),
    })
  );
  await invalidateSandboxMail(queryClient, mailboxId);
};

const updateDemoThreadLabels = async (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) => {
  updateMessages(
    mailboxId,
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      labelIds: applyLabelIdChanges(message.labelIds, changes),
    })
  );
  await invalidateSandboxMail(queryClient, mailboxId);
};

const removeDemoThread = async (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string
) => {
  removeMessages(mailboxId, (message) => message.threadId === threadId);
  await invalidateSandboxMail(queryClient, mailboxId);
};

const markItemReadState = async (
  queryClient: QueryClient,
  mailboxId: string,
  itemId: string,
  unread: boolean
) => {
  await markDemoThreadReadState(
    queryClient,
    mailboxId,
    getThreadIdForItem(mailboxId, itemId),
    unread
  );
};

const updateItemLabels = async (
  queryClient: QueryClient,
  mailboxId: string,
  itemId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) => {
  await updateDemoThreadLabels(
    queryClient,
    mailboxId,
    getThreadIdForItem(mailboxId, itemId),
    changes
  );
};

const moveToTrashChanges = {
  addLabelIds: [MAILBOX_LABELS.trash],
  removeLabelIds: [
    MAILBOX_LABELS.inbox,
    MAILBOX_LABELS.spam,
    MAILBOX_LABELS.sent,
    MAILBOX_LABELS.drafts,
  ],
};

const markAsSpamChanges = {
  addLabelIds: [MAILBOX_LABELS.spam],
  removeLabelIds: [MAILBOX_LABELS.inbox],
};

const archiveChanges = {
  removeLabelIds: [MAILBOX_LABELS.inbox],
};

const moveToInboxFromSpamChanges = {
  addLabelIds: [MAILBOX_LABELS.inbox],
  removeLabelIds: [MAILBOX_LABELS.spam],
};

const moveToInboxFromTrashChanges = {
  addLabelIds: [MAILBOX_LABELS.inbox],
  removeLabelIds: [MAILBOX_LABELS.trash],
};

export const createDemoMailboxActions = (
  queryClient: QueryClient,
  mailboxId = DEMO_MAILBOX_ID
) => ({
  archiveMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, archiveChanges);
  },
  archiveThread: async (threadId: string) => {
    await updateDemoThreadLabels(
      queryClient,
      mailboxId,
      threadId,
      archiveChanges
    );
  },
  archiveThreads: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateDemoThreadLabels(
          queryClient,
          mailboxId,
          thread.threadId,
          archiveChanges
        );
      })
    );
  },
  deleteDraft: async (message: MessageListItem) => {
    await removeDemoThread(queryClient, mailboxId, message.threadId);
  },
  deleteDrafts: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await removeDemoThread(queryClient, mailboxId, thread.threadId);
      })
    );
  },
  markMessageAsRead: async (messageId: string) => {
    await markItemReadState(queryClient, mailboxId, messageId, false);
  },
  markMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(
      queryClient,
      mailboxId,
      messageId,
      markAsSpamChanges
    );
  },
  markMessageAsUnread: async (messageId: string) => {
    await markItemReadState(queryClient, mailboxId, messageId, true);
  },
  markThreadAsRead: async (threadId: string) => {
    await markDemoThreadReadState(queryClient, mailboxId, threadId, false);
  },
  markThreadAsSpam: async (threadId: string) => {
    await updateDemoThreadLabels(
      queryClient,
      mailboxId,
      threadId,
      markAsSpamChanges
    );
  },
  markThreadAsUnread: async (threadId: string) => {
    await markDemoThreadReadState(queryClient, mailboxId, threadId, true);
  },
  markThreadsAsRead: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await markDemoThreadReadState(
          queryClient,
          mailboxId,
          thread.threadId,
          false
        );
      })
    );
  },
  markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateDemoThreadLabels(
          queryClient,
          mailboxId,
          thread.threadId,
          markAsSpamChanges
        );
      })
    );
  },
  markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await markDemoThreadReadState(
          queryClient,
          mailboxId,
          thread.threadId,
          true
        );
      })
    );
  },
  moveMessageToTrash: async (messageId: string) => {
    await updateItemLabels(
      queryClient,
      mailboxId,
      messageId,
      moveToTrashChanges
    );
  },
  moveThreadToTrash: async (threadId: string) => {
    await updateDemoThreadLabels(
      queryClient,
      mailboxId,
      threadId,
      moveToTrashChanges
    );
  },
  moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateDemoThreadLabels(
          queryClient,
          mailboxId,
          thread.threadId,
          moveToTrashChanges
        );
      })
    );
  },
  unmarkMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(
      queryClient,
      mailboxId,
      messageId,
      moveToInboxFromSpamChanges
    );
  },
  unmarkThreadAsSpam: async (threadId: string) => {
    await updateDemoThreadLabels(
      queryClient,
      mailboxId,
      threadId,
      moveToInboxFromSpamChanges
    );
  },
  unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateDemoThreadLabels(
          queryClient,
          mailboxId,
          thread.threadId,
          moveToInboxFromSpamChanges
        );
      })
    );
  },
  unsubscribeFromMessage: async () => {
    await delay(0);
  },
  untrashMessage: async (messageId: string) => {
    await updateItemLabels(
      queryClient,
      mailboxId,
      messageId,
      moveToInboxFromTrashChanges
    );
  },
  untrashThread: async (threadId: string) => {
    await updateDemoThreadLabels(
      queryClient,
      mailboxId,
      threadId,
      moveToInboxFromTrashChanges
    );
  },
  untrashThreads: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateDemoThreadLabels(
          queryClient,
          mailboxId,
          thread.threadId,
          moveToInboxFromTrashChanges
        );
      })
    );
  },
  updateMessageLabels: async (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
  ) => {
    await updateItemLabels(queryClient, mailboxId, messageId, changes);
  },
  updateThreadLabels: async (
    threadId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
  ) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, changes);
  },
  updateThreadsLabels: async (
    updates: readonly {
      threadId: string;
      addLabelIds?: string[];
      removeLabelIds?: string[];
    }[]
  ) => {
    await Promise.all(
      updates.map(async ({ threadId, ...changes }) => {
        await updateDemoThreadLabels(queryClient, mailboxId, threadId, changes);
      })
    );
  },
});

export const saveDemoDraft = (draft: ComposeDraftState): ComposeDraftState => {
  const messageId = draft.messageId ?? `demo-draft-message-${draft.localId}`;
  const draftId = draft.draftId ?? `demo-draft-${draft.localId}`;
  const savedDraft = {
    ...draft,
    draftId,
    errorMessage: null,
    lastSavedAt: Date.now(),
    messageId,
    saveStatus: "saved" as const,
    updatedAt: Date.now(),
  };

  const message = createMessage(messageId, {
    bodyHtml: savedDraft.bodyHtml,
    bodyText: savedDraft.bodyText,
    date: new Date(savedDraft.updatedAt).toISOString(),
    draftId,
    from: DEMO_EMAIL_ADDRESS,
    labelIds: [MAILBOX_LABELS.drafts],
    snippet: savedDraft.bodyText || savedDraft.subject,
    subject: savedDraft.subject,
    threadId: savedDraft.replyContext?.threadId ?? messageId,
    to: savedDraft.recipients.to,
  });

  updateDemoState((state) => ({
    ...state,
    messages: [
      ...state.messages.filter((entry) => entry.id !== messageId),
      message,
    ],
  }));

  return savedDraft;
};

export const sendDemoDraft = (draft: ComposeDraftState) => {
  const messageId = `demo-sent-${crypto.randomUUID()}`;
  const sentMessage = createMessage(messageId, {
    bodyHtml: draft.bodyHtml,
    bodyText: draft.bodyText,
    date: new Date().toISOString(),
    from: DEMO_EMAIL_ADDRESS,
    labelIds: [MAILBOX_LABELS.sent],
    snippet: draft.bodyText || draft.subject,
    subject: draft.subject,
    threadId: draft.replyContext?.threadId ?? messageId,
    to: draft.recipients.to,
  });

  updateDemoState((state) => ({
    ...state,
    messages: [
      ...state.messages.filter(
        (entry) =>
          entry.id !== draft.messageId && entry.draftId !== draft.draftId
      ),
      sentMessage,
    ],
  }));

  return { id: sentMessage.id, threadId: sentMessage.threadId };
};

export const deleteDemoDraft = (draft: ComposeDraftState) => {
  removeMessages(
    DEMO_MAILBOX_ID,
    (message) =>
      message.id === draft.messageId || message.draftId === draft.draftId
  );
};
