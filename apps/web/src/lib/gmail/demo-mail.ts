import type { QueryClient } from "@tanstack/react-query";
import type { ComposeDraftState } from "~/features/compose";
import { clientEnv } from "~/env";
import { parseStructuredSearchQuery } from "~/features/message-search/state/message-list-search-state";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import type { ThreadListEntry } from "./thread-list";
import {
  addUnreadLabel,
  applyLabelIdChanges,
  isMessageUnread,
  isMessageInMailbox,
  MAILBOX_LABELS,
  removeUnreadLabel,
  type GmailLabelListItem,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "./gmail";
import { getMailboxThreadQueriesKey } from "./thread-query";

export const DEMO_MAILBOX_ID = "demo:mailbox";
export const LANDING_DEMO_MAILBOX_ID = "landing:mailbox";

export { isSandboxMailboxId } from "~/lib/sandbox-mailbox";

const DEMO_EMAIL_ADDRESS = "demo@quieter.email";

const DEMO_MAIL_STORAGE_KEY = "quieter:demo-mail-state";
const DEMO_MAIL_STATE_VERSION = 3;

type DemoMailState = {
  version: number;
  messages: MessageListItem[];
};

let landingDemoState: DemoMailState | null = null;

export const resetLandingDemoMail = () => {
  landingDemoState = createInitialDemoState();
};

const now = Date.now();

const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

const logo = (domain: string) => {
  const token = clientEnv.VITE_LOGO_DEV_PUBLISHABLE_KEY;
  const createUrl = (theme: "dark" | "light") => {
    const url = new URL(`https://img.logo.dev/${domain}`);
    url.searchParams.set("size", "64");
    url.searchParams.set("theme", theme);
    url.searchParams.set("format", "webp");
    url.searchParams.set("fallback", "404");

    if (token) {
      url.searchParams.set("token", token);
    }

    return url.toString();
  };

  return {
    dark: createUrl("dark"),
    light: createUrl("light"),
  };
};

const attachment = (fileName: string, mimeType: string, size: number, id = fileName) => ({
  attachmentId: `demo-attachment-${id}`,
  fileName,
  mimeType,
  size,
});

const createMessage = (
  id: string,
  fields: Omit<MessageListItem, "id" | "threadId" | "messageHeaderId" | "internalDate"> & {
    threadId?: string;
  },
): MessageListItem => ({
  id,
  threadId: fields.threadId ?? id,
  messageHeaderId: `<${id}@demo.quieter.local>`,
  internalDate: fields.date ?? daysAgo(0),
  ...fields,
});

const createInitialDemoState = (): DemoMailState => ({
  version: DEMO_MAIL_STATE_VERSION,
  messages: [
    createMessage("demo-stripe-1", {
      attachments: [attachment("april-payouts.csv", "text/csv", 184_320)],
      bodyHtml:
        "<p>Your April payout reconciliation is ready.</p><p>There are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.</p>",
      bodyText:
        "Your April payout reconciliation is ready.\n\nThere are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.",
      date: daysAgo(0.08),
      from: "Stripe <support@stripe.com>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Finance"],
      senderAvatarUrls: logo("stripe.com"),
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
      senderAvatarUrls: logo("github.com"),
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
      senderAvatarUrls: logo("linear.app"),
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
      from: "Maya Patel <maya@notion.so>",
      labelIds: [MAILBOX_LABELS.inbox],
      senderAvatarUrls: logo("notion.so"),
      snippet:
        "I drafted the customer onboarding checklist in Notion. The sections that still need owner names are highlighted.",
      subject: "Onboarding checklist draft",
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: "Demo <demo@quieter.email>, Jordan Lee <jordan@figma.com>",
    }),
    createMessage("demo-thread-notion-2", {
      bodyHtml:
        "<p>Looks good. I added the lifecycle emails and moved the workspace invite step earlier.</p><p>Jordan, can you check the screenshots before we share it?</p>",
      bodyText:
        "Looks good. I added the lifecycle emails and moved the workspace invite step earlier.\n\nJordan, can you check the screenshots before we share it?",
      date: daysAgo(0.75),
      from: DEMO_EMAIL_ADDRESS,
      labelIds: [MAILBOX_LABELS.sent],
      snippet:
        "Looks good. I added the lifecycle emails and moved the workspace invite step earlier.",
      subject: "Re: Onboarding checklist draft",
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: "Maya Patel <maya@notion.so>, Jordan Lee <jordan@figma.com>",
    }),
    createMessage("demo-thread-notion-3", {
      attachments: [attachment("onboarding-screenshots.zip", "application/zip", 3_900_000)],
      bodyHtml:
        "<p>I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.</p>",
      bodyText:
        "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
      date: daysAgo(0.58),
      from: "Jordan Lee <jordan@figma.com>",
      isUnread: true,
      labelIds: [MAILBOX_LABELS.inbox, "UNREAD", "Label_Product"],
      senderAvatarUrls: logo("figma.com"),
      snippet:
        "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
      subject: "Re: Onboarding checklist draft",
      threadAttachmentCount: 1,
      threadId: "demo-thread-onboarding",
      threadMessageCount: 3,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-vercel-1", {
      bodyHtml:
        "<p>Your preview deployment is ready.</p><p><strong>quieter-web-git-demo-mode</strong> built successfully and is available for review.</p>",
      bodyText:
        "Your preview deployment is ready.\n\nquieter-web-git-demo-mode built successfully and is available for review.",
      date: daysAgo(1.16),
      from: "Vercel <notifications@vercel.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Product"],
      senderAvatarUrls: logo("vercel.com"),
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
      from: "Slack <feedback@slack.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      senderAvatarUrls: logo("slack.com"),
      snippet:
        "You have 4 unread mentions in #product. The most recent thread is about the new mailbox switcher behavior.",
      subject: "New mentions in #product",
      to: DEMO_EMAIL_ADDRESS,
      unsubscribeMailto: "mailto:unsubscribe@slack.com?subject=unsubscribe",
    }),
    createMessage("demo-openai-1", {
      attachments: [attachment("usage-summary.pdf", "application/pdf", 612_400)],
      bodyHtml:
        "<p>Your weekly usage summary is attached.</p><p>Token volume increased 18% week over week, mostly from background classification jobs.</p>",
      bodyText:
        "Your weekly usage summary is attached.\n\nToken volume increased 18% week over week, mostly from background classification jobs.",
      date: daysAgo(2.25),
      from: "OpenAI <noreply@openai.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Finance"],
      senderAvatarUrls: logo("openai.com"),
      snippet: "Your weekly usage summary is attached. Token volume increased 18% week over week.",
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
      from: "Shopify <no-reply@shopify.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      senderAvatarUrls: logo("shopify.com"),
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
          1_240_000,
        ),
      ],
      bodyHtml:
        "<p>Here is the latest research export from Airtable. I filtered it down to accounts with active pilot conversations.</p>",
      bodyText:
        "Here is the latest research export from Airtable. I filtered it down to accounts with active pilot conversations.",
      date: daysAgo(3.3),
      from: "Rachel Kim <rachel@airtable.com>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Clients"],
      senderAvatarUrls: logo("airtable.com"),
      snippet:
        "Here is the latest research export from Airtable. I filtered it down to active pilot conversations.",
      subject: "Pilot account research export",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-dropbox-1", {
      bodyHtml:
        "<p>Sam shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and customer quote approvals.</p>",
      bodyText:
        "Sam shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and customer quote approvals.",
      date: daysAgo(4.1),
      from: "Dropbox <no-reply@dropbox.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      senderAvatarUrls: logo("dropbox.com"),
      snippet:
        "Sam shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and approvals.",
      subject: "Q2 launch folder shared with you",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-zoom-1", {
      attachments: [attachment("customer-call-transcript.vtt", "text/vtt", 98_500)],
      bodyHtml:
        "<p>Your cloud recording is ready.</p><p>The transcript includes action items from the customer call with Northstar Analytics.</p>",
      bodyText:
        "Your cloud recording is ready.\n\nThe transcript includes action items from the customer call with Northstar Analytics.",
      date: daysAgo(4.7),
      from: "Zoom <no-reply@zoom.us>",
      labelIds: [MAILBOX_LABELS.inbox, "Label_Clients"],
      senderAvatarUrls: logo("zoom.us"),
      snippet:
        "Your cloud recording is ready. The transcript includes action items from the customer call.",
      subject: "Cloud recording: Northstar Analytics sync",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-anthropic-1", {
      bodyHtml:
        "<p>Your workspace security report is ready. No high severity issues were detected in the last 7 days.</p>",
      bodyText:
        "Your workspace security report is ready. No high severity issues were detected in the last 7 days.",
      date: daysAgo(5.2),
      from: "Anthropic <support@anthropic.com>",
      labelIds: [MAILBOX_LABELS.inbox],
      senderAvatarUrls: logo("anthropic.com"),
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
      to: "Priya Shah <priya@figma.com>",
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
      to: "Rachel Kim <rachel@airtable.com>",
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
      to: "Sam Rivera <sam@vercel.com>",
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
      to: "Alex Morgan <alex@linear.app>",
    }),
    createMessage("demo-spam-1", {
      bodyHtml: "<p>Congratulations, your account has been selected for a limited reward.</p>",
      bodyText: "Congratulations, your account has been selected for a limited reward.",
      date: daysAgo(5.6),
      from: "Rewards <promo@temu.com>",
      labelIds: [MAILBOX_LABELS.spam],
      senderAvatarUrls: logo("temu.com"),
      snippet: "Congratulations, your account has been selected for a limited reward.",
      subject: "Limited reward available",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-spam-2", {
      bodyHtml:
        "<p>Your file transfer is waiting. Open the secure portal to prevent expiration.</p>",
      bodyText: "Your file transfer is waiting. Open the secure portal to prevent expiration.",
      date: daysAgo(6.8),
      from: "File Transfer <notice@wetransfer.com>",
      labelIds: [MAILBOX_LABELS.spam],
      senderAvatarUrls: logo("wetransfer.com"),
      snippet: "Your file transfer is waiting. Open the secure portal to prevent expiration.",
      subject: "Action required: file transfer expires soon",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-trash-1", {
      bodyHtml: "<p>Can we move the old staging notes out of the main workspace?</p>",
      bodyText: "Can we move the old staging notes out of the main workspace?",
      date: daysAgo(7.3),
      from: "Old Notes <notes@evernote.com>",
      labelIds: [MAILBOX_LABELS.trash],
      senderAvatarUrls: logo("evernote.com"),
      snippet: "Can we move the old staging notes out of the main workspace?",
      subject: "Old staging notes",
      to: DEMO_EMAIL_ADDRESS,
    }),
    createMessage("demo-trash-2", {
      attachments: [attachment("legacy-import.json", "application/json", 264_000)],
      bodyHtml:
        "<p>The legacy import sample is attached. We can delete this once the parser tests are updated.</p>",
      bodyText:
        "The legacy import sample is attached. We can delete this once the parser tests are updated.",
      date: daysAgo(8.9),
      from: "Datadog <notifications@datadoghq.com>",
      labelIds: [MAILBOX_LABELS.trash],
      senderAvatarUrls: logo("datadoghq.com"),
      snippet:
        "The legacy import sample is attached. We can delete this once the parser tests are updated.",
      subject: "Legacy import sample",
      threadAttachmentCount: 1,
      to: DEMO_EMAIL_ADDRESS,
    }),
  ],
});

const readDemoState = (): DemoMailState => {
  if (typeof window === "undefined") return createInitialDemoState();

  const raw = window.localStorage.getItem(DEMO_MAIL_STORAGE_KEY);
  if (!raw) return createInitialDemoState();

  try {
    const parsed = JSON.parse(raw) as DemoMailState;
    return parsed.version === DEMO_MAIL_STATE_VERSION && Array.isArray(parsed.messages)
      ? parsed
      : createInitialDemoState();
  } catch {
    return createInitialDemoState();
  }
};

const writeDemoState = (state: DemoMailState) => {
  window.localStorage.setItem(DEMO_MAIL_STORAGE_KEY, JSON.stringify(state));
};

const readLandingDemoState = (): DemoMailState => {
  if (!landingDemoState) {
    landingDemoState = createInitialDemoState();
  }

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
  updater: (state: DemoMailState) => DemoMailState,
) => {
  writeSandboxState(mailboxId, updater(readSandboxState(mailboxId)));
};

const invalidateSandboxMail = async (queryClient: QueryClient, mailboxId: string) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["messages", mailboxId] }),
    queryClient.invalidateQueries({ queryKey: getMailboxThreadQueriesKey(mailboxId) }),
    ...(mailboxId === DEMO_MAILBOX_ID
      ? [queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() })]
      : []),
  ]);
};

const getSortedMessages = (mailboxId: string) =>
  readSandboxState(mailboxId).messages.toSorted(
    (left, right) =>
      Number(new Date(right.internalDate ?? right.date ?? 0)) -
      Number(new Date(left.internalDate ?? left.date ?? 0)),
  );

const textMatchesQuery = (value: string | null | undefined, query: string) =>
  value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false;

const parseRelativeSearchDuration = (value: string) => {
  const match = /^(\d+)([dmy])$/.exec(value.trim().toLocaleLowerCase());
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = match[2];
  const days = unit === "d" ? amount : unit === "m" ? amount * 30 : amount * 365;
  return days * 24 * 60 * 60 * 1000;
};

const getMessageTime = (message: MessageListItem) =>
  new Date(message.internalDate ?? message.date ?? 0).getTime();

const messageMatchesQuery = (message: MessageListItem, query: string | undefined) => {
  if (!query) return true;

  const structuredQuery = parseStructuredSearchQuery(query);
  for (const filter of structuredQuery.filters) {
    if (filter.type === "after" || filter.type === "before") {
      const filterTime = new Date(filter.value).getTime();
      if (Number.isNaN(filterTime)) return false;

      const messageTime = getMessageTime(message);
      if (filter.type === "after" ? messageTime <= filterTime : messageTime >= filterTime) {
        return false;
      }
      continue;
    }

    if (filter.type === "older_than" || filter.type === "newer_than") {
      const duration = parseRelativeSearchDuration(filter.value);
      if (duration === null) return false;

      const isOlder = Date.now() - getMessageTime(message) > duration;
      if (filter.type === "older_than" ? !isOlder : isOlder) {
        return false;
      }
      continue;
    }

    if (filter.type === "has") {
      if ((message.attachments?.length ?? 0) === 0) return false;
      continue;
    }

    if (filter.type === "is") {
      if (filter.value === "unread" ? !isMessageUnread(message) : isMessageUnread(message)) {
        return false;
      }
      continue;
    }

    if (filter.type === "label") {
      const labelId = `Label_${filter.value}`;
      if (!message.labelIds?.some((id) => id.toLocaleLowerCase() === labelId.toLocaleLowerCase())) {
        return false;
      }
      continue;
    }

    const filterTargets: Partial<Record<string, Array<string | null | undefined>>> = {
      bcc: [message.bcc],
      cc: [message.cc],
      content: [message.bodyText, message.snippet],
      filename: message.attachments?.map((attachment) => attachment.fileName) ?? [],
      from: [message.from],
      subject: [message.subject],
      to: [message.to],
    };
    const targets = filterTargets[filter.type];
    if (targets && !targets.some((target) => textMatchesQuery(target, filter.value))) {
      return false;
    }
  }

  if (!structuredQuery.text) return true;

  const haystack = [message.subject, message.from, message.to, message.snippet, message.bodyText]
    .join(" ")
    .toLowerCase();

  return haystack.includes(structuredQuery.text.toLowerCase());
};

export const getDemoMailboxes = () => ({
  defaultMailboxId: DEMO_MAILBOX_ID,
  groups: [
    {
      id: "demo-team",
      kind: "organization" as const,
      name: "Demo",
      slug: "demo-team",
      mailboxes: [
        {
          connectionStatus: "connected" as const,
          displayName: "Demo Mailbox",
          emailAddress: DEMO_EMAIL_ADDRESS,
          grantRole: null,
          gmailAutoLabelEnabled: false,
          gmailUsefulDetailsEnabled: false,
          groupId: "demo-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: DEMO_MAILBOX_ID,
          organizationId: "demo-team",
          ownerUserId: "demo-user",
          provider: "gmail" as const,
        },
      ],
    },
  ],
});

export const getLandingDemoMailboxes = () => ({
  defaultMailboxId: LANDING_DEMO_MAILBOX_ID,
  groups: [
    {
      id: "landing-demo-team",
      kind: "organization" as const,
      name: "Demo",
      slug: "landing-demo-team",
      mailboxes: [
        {
          connectionStatus: "connected" as const,
          displayName: "Demo Mailbox",
          emailAddress: DEMO_EMAIL_ADDRESS,
          grantRole: null,
          gmailAutoLabelEnabled: false,
          gmailUsefulDetailsEnabled: false,
          groupId: "landing-demo-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: LANDING_DEMO_MAILBOX_ID,
          organizationId: "landing-demo-team",
          ownerUserId: "landing-demo-user",
          provider: "gmail" as const,
        },
      ],
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
  const start = pageToken ? Number(pageToken) || 0 : 0;
  const messages = getSortedMessages(mailboxId).filter(
    (message) => isMessageInMailbox(message, category) && messageMatchesQuery(message, query),
  );
  const page = messages.slice(start, start + maxResults);
  const nextOffset = start + maxResults;

  return {
    historyId: "demo-history",
    messages: page,
    nextPageToken: nextOffset < messages.length ? String(nextOffset) : undefined,
    resultSizeEstimate: messages.length,
  };
};

export const getDemoThread = (mailboxId: string, threadId: string): ThreadMessagesResult => {
  const messages = getSortedMessages(mailboxId).filter((message) => message.threadId === threadId);

  return {
    messages,
    snippet: messages[0]?.snippet,
    subject: messages[0]?.subject,
    threadId,
  };
};

export const getDemoLabels = (): Array<
  GmailLabelListItem & { description: string | null; inclusionCriteria: string | null }
> => [
  {
    description: "Client conversations and account activity.",
    id: "Label_Clients",
    inclusionCriteria: "Messages from clients about active work, requests, and account updates.",
    name: "Clients",
    type: "user",
  },
  {
    description: "Product planning, feedback, and release work.",
    id: "Label_Product",
    inclusionCriteria: "Product feedback, feature discussions, bug reports, and release updates.",
    name: "Product",
    type: "user",
  },
];

export const getDemoMessageInspector = (
  mailboxId: string,
  messageId: string,
): MessageInspectorResult => {
  const message = readSandboxState(mailboxId).messages.find((entry) => entry.id === messageId);

  return {
    id: messageId,
    date: message?.date,
    from: message?.from,
    headers: [
      { name: "From", value: message?.from ?? "" },
      { name: "To", value: message?.to ?? "" },
      { name: "Subject", value: message?.subject ?? "" },
    ],
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
  update: (message: MessageListItem) => MessageListItem,
) => {
  updateSandboxState(mailboxId, (state) => ({
    ...state,
    messages: state.messages.map((message) => (predicate(message) ? update(message) : message)),
  }));
};

const removeMessages = (mailboxId: string, predicate: (message: MessageListItem) => boolean) => {
  updateSandboxState(mailboxId, (state) => ({
    ...state,
    messages: state.messages.filter((message) => !predicate(message)),
  }));
};

const getThreadIdForItem = (mailboxId: string, itemId: string) =>
  readSandboxState(mailboxId).messages.find((message) => message.id === itemId)?.threadId ?? itemId;

const markItemReadState = async (
  queryClient: QueryClient,
  mailboxId: string,
  itemId: string,
  unread: boolean,
) => {
  await markDemoThreadReadState(
    queryClient,
    mailboxId,
    getThreadIdForItem(mailboxId, itemId),
    unread,
  );
};

const updateItemLabels = async (
  queryClient: QueryClient,
  mailboxId: string,
  itemId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
) => {
  await updateDemoThreadLabels(
    queryClient,
    mailboxId,
    getThreadIdForItem(mailboxId, itemId),
    changes,
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
  mailboxId = DEMO_MAILBOX_ID,
) => ({
  archiveMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, archiveChanges);
  },
  archiveThread: async (threadId: string) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, archiveChanges);
  },
  archiveThreads: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateDemoThreadLabels(queryClient, mailboxId, thread.threadId, archiveChanges),
      ),
    );
  },
  deleteDraft: async (message: MessageListItem) => {
    await removeDemoThread(queryClient, mailboxId, message.threadId);
  },
  deleteDrafts: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) => removeDemoThread(queryClient, mailboxId, thread.threadId)),
    );
  },
  markMessageAsRead: async (messageId: string) => {
    await markItemReadState(queryClient, mailboxId, messageId, false);
  },
  markMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, markAsSpamChanges);
  },
  markMessageAsUnread: async (messageId: string) => {
    await markItemReadState(queryClient, mailboxId, messageId, true);
  },
  markThreadAsRead: async (threadId: string) => {
    await markDemoThreadReadState(queryClient, mailboxId, threadId, false);
  },
  markThreadAsSpam: async (threadId: string) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, markAsSpamChanges);
  },
  markThreadsAsRead: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        markDemoThreadReadState(queryClient, mailboxId, thread.threadId, false),
      ),
    );
  },
  markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateDemoThreadLabels(queryClient, mailboxId, thread.threadId, markAsSpamChanges),
      ),
    );
  },
  markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        markDemoThreadReadState(queryClient, mailboxId, thread.threadId, true),
      ),
    );
  },
  markThreadAsUnread: async (threadId: string) => {
    await markDemoThreadReadState(queryClient, mailboxId, threadId, true);
  },
  moveMessageToTrash: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, moveToTrashChanges);
  },
  moveThreadToTrash: async (threadId: string) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, moveToTrashChanges);
  },
  moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateDemoThreadLabels(queryClient, mailboxId, thread.threadId, moveToTrashChanges),
      ),
    );
  },
  unmarkMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, moveToInboxFromSpamChanges);
  },
  unmarkThreadAsSpam: async (threadId: string) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, moveToInboxFromSpamChanges);
  },
  unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateDemoThreadLabels(queryClient, mailboxId, thread.threadId, moveToInboxFromSpamChanges),
      ),
    );
  },
  unsubscribeFromMessage: async () => {},
  untrashMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, mailboxId, messageId, moveToInboxFromTrashChanges);
  },
  untrashThread: async (threadId: string) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, moveToInboxFromTrashChanges);
  },
  updateMessageLabels: async (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => {
    await updateItemLabels(queryClient, mailboxId, messageId, changes);
  },
  updateThreadLabels: async (
    threadId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => {
    await updateDemoThreadLabels(queryClient, mailboxId, threadId, changes);
  },
});

const markDemoThreadReadState = async (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string,
  unread: boolean,
) => {
  updateMessages(
    mailboxId,
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      isUnread: unread,
      labelIds: unread ? addUnreadLabel(message.labelIds) : removeUnreadLabel(message.labelIds),
    }),
  );
  await invalidateSandboxMail(queryClient, mailboxId);
};

const updateDemoThreadLabels = async (
  queryClient: QueryClient,
  mailboxId: string,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
) => {
  updateMessages(
    mailboxId,
    (message) => message.threadId === threadId,
    (message) => ({ ...message, labelIds: applyLabelIdChanges(message.labelIds, changes) }),
  );
  await invalidateSandboxMail(queryClient, mailboxId);
};

const removeDemoThread = async (queryClient: QueryClient, mailboxId: string, threadId: string) => {
  removeMessages(mailboxId, (message) => message.threadId === threadId);
  await invalidateSandboxMail(queryClient, mailboxId);
};

export const saveDemoDraft = async (draft: ComposeDraftState): Promise<ComposeDraftState> => {
  const messageId = draft.messageId ?? `demo-draft-message-${draft.localId}`;
  const draftId = draft.draftId ?? `demo-draft-${draft.localId}`;
  const savedDraft = {
    ...draft,
    draftId,
    messageId,
    saveStatus: "saved" as const,
    errorMessage: null,
    lastSavedAt: Date.now(),
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
    messages: [...state.messages.filter((entry) => entry.id !== messageId), message],
  }));

  return savedDraft;
};

export const sendDemoDraft = async (draft: ComposeDraftState) => {
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
        (entry) => entry.id !== draft.messageId && entry.draftId !== draft.draftId,
      ),
      sentMessage,
    ],
  }));

  return { id: sentMessage.id, threadId: sentMessage.threadId };
};

export const deleteDemoDraft = async (draft: ComposeDraftState) => {
  removeMessages(
    DEMO_MAILBOX_ID,
    (message) => message.id === draft.messageId || message.draftId === draft.draftId,
  );
};
