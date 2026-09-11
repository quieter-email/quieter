import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import type { QueryClient } from "@tanstack/react-query";

import {
  createDemoActions,
  createDemoComposeActions,
} from "#/lib/demo-mail/actions";
import type { DemoMessageStore } from "#/lib/demo-mail/actions";
import { createDemoMessage as createMessage } from "#/lib/demo-mail/fixtures";
import { getDemoMailThread, listDemoMail } from "#/lib/demo-mail/queries";
import { isMessageUnread, MAILBOX_LABELS } from "#/lib/mail";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";

export const DEMO_MANAGED_MAILBOX_ID = "demo:managed-mailbox";
const DEMO_MANAGED_EMAIL_ADDRESS = "support@quieter.com";
const DEMO_MANAGED_MAIL_STORAGE_KEY = "quieter:managed-demo-mail-state";
const DEMO_MANAGED_MAIL_STATE_VERSION = 3;
const MANAGED_DEMO_THREAD_QUERY_VERSION = 3;

const DEMO_MANAGED_LABEL_IDS = {
  billing: "demo-managed-label-billing",
  support: "demo-managed-label-support",
  vip: "demo-managed-label-vip",
} as const;
const DEMO_MANAGED_LABEL_ID_SET = new Set<string>(
  Object.values(DEMO_MANAGED_LABEL_IDS)
);

type ManagedDemoMailState = {
  labels: ManagedDemoLabel[];
  messages: MessageListItem[];
  version: number;
};

type ManagedDemoLabel = {
  color: MailboxLabelColor;
  description: string | null;
  id: string;
  name: string;
  position: number;
  visible: boolean;
};

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const createInitialLabels = (): ManagedDemoLabel[] => [
  {
    color: "blue",
    description: "Customer support conversations.",
    id: DEMO_MANAGED_LABEL_IDS.support,
    name: "Support",
    position: 0,
    visible: true,
  },
  {
    color: "green",
    description: "Invoices and payment follow-ups.",
    id: DEMO_MANAGED_LABEL_IDS.billing,
    name: "Billing",
    position: 1,
    visible: true,
  },
  {
    color: "purple",
    description: "Priority partner accounts.",
    id: DEMO_MANAGED_LABEL_IDS.vip,
    name: "VIP",
    position: 2,
    visible: true,
  },
];

const labelIds = (...ids: string[]) => ids;

const createInitialDemoState = (): ManagedDemoMailState => ({
  labels: createInitialLabels(),
  messages: [
    createMessage("managed-demo-msg-1", {
      bodyHtml:
        "<p>Hi,</p><p>Our finance team keeps getting redirected after login. Can you confirm whether SSO is enabled for our account?</p><p>Thanks,<br>Jordan</p>",
      bodyText:
        "Hi,\n\nOur finance team keeps getting redirected after login. Can you confirm whether SSO is enabled for our account?\n\nThanks,\nJordan",
      date: daysAgo(0.2),
      from: "Jordan Lee <jordan@linear.app>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.support
      ),
      snippet: "Our finance team keeps getting redirected after login.",
      subject: "Cannot access billing portal",
      threadId: "managed-demo-thread-support",
      to: DEMO_MANAGED_EMAIL_ADDRESS,
    }),
    createMessage("managed-demo-msg-2", {
      bodyHtml:
        "<p>Hi Jordan,</p><p>SSO is enabled for your organization. I reset the stale session on your side — please try again in a private window.</p><p>Best,<br>Support</p>",
      bodyText:
        "Hi Jordan,\n\nSSO is enabled for your organization. I reset the stale session on your side — please try again in a private window.\n\nBest,\nSupport",
      date: daysAgo(0.15),
      from: DEMO_MANAGED_EMAIL_ADDRESS,
      isUnread: false,
      labelIds: labelIds(MAILBOX_LABELS.sent),
      snippet: "SSO is enabled. I reset the stale session on your side.",
      subject: "Re: Cannot access billing portal",
      threadId: "managed-demo-thread-support",
      to: "Jordan Lee <jordan@linear.app>",
    }),
    createMessage("managed-demo-msg-3", {
      bodyHtml:
        "<p>Hello,</p><p>Please confirm receipt of invoice 4821 and let us know the expected payment date.</p><p>Regards,<br>Accounts Payable</p>",
      bodyText:
        "Hello,\n\nPlease confirm receipt of invoice 4821 and let us know the expected payment date.\n\nRegards,\nAccounts Payable",
      date: daysAgo(1.1),
      from: "Accounts Payable <billing@stripe.com>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.billing
      ),
      snippet: "Please confirm receipt of invoice 4821.",
      subject: "Invoice 4821 due next week",
      threadId: "managed-demo-thread-billing",
      to: DEMO_MANAGED_EMAIL_ADDRESS,
    }),
    createMessage("managed-demo-msg-4", {
      bodyHtml:
        "<p>Team,</p><p>We need the managed mailbox live before the partner launch on Monday. Can you confirm the DNS checklist is complete?</p><p>Morgan</p>",
      bodyText:
        "Team,\n\nWe need the managed mailbox live before the partner launch on Monday. Can you confirm the DNS checklist is complete?\n\nMorgan",
      date: daysAgo(0.05),
      from: "Morgan Ellis <morgan@notion.so>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.support,
        DEMO_MANAGED_LABEL_IDS.vip
      ),
      snippet:
        "We need the managed mailbox live before the partner launch on Monday.",
      subject: "Priority onboarding for Monday",
      threadId: "managed-demo-thread-vip",
      to: DEMO_MANAGED_EMAIL_ADDRESS,
    }),
    createMessage("managed-demo-msg-5", {
      bodyHtml:
        "<p>Hi,</p><p>Sharing the latest label counts from local fixtures.</p><p>This message is outbound-only for Sent view testing.</p>",
      bodyText:
        "Hi,\n\nSharing the latest label counts from local fixtures.\n\nThis message is outbound-only for Sent view testing.",
      date: daysAgo(2),
      from: DEMO_MANAGED_EMAIL_ADDRESS,
      isUnread: false,
      labelIds: labelIds(MAILBOX_LABELS.sent),
      snippet: "Sharing the latest label counts from local fixtures.",
      subject: "Weekly managed mail summary",
      threadId: "managed-demo-thread-sent",
      to: "Onboarding <onboarding@quieter.com>",
    }),
    createMessage("managed-demo-msg-6", {
      bodyHtml: "<p>Claim your reward immediately.</p>",
      bodyText: "Claim your reward immediately.",
      date: daysAgo(3),
      from: "Prize Desk <rewards@promo-claim.net>",
      isUnread: false,
      labelIds: labelIds(MAILBOX_LABELS.spam),
      snippet: "Claim your reward immediately.",
      subject: "You have already won",
      threadId: "managed-demo-thread-spam",
      to: DEMO_MANAGED_EMAIL_ADDRESS,
    }),
    createMessage("managed-demo-msg-7", {
      bodyHtml: "<p>This message belongs in trash for local UI testing.</p>",
      bodyText: "This message belongs in trash for local UI testing.",
      date: daysAgo(4),
      from: "Old Thread <archive@company-history.org>",
      isUnread: false,
      labelIds: labelIds(MAILBOX_LABELS.trash),
      snippet: "This message belongs in trash for local UI testing.",
      subject: "Archived conversation",
      threadId: "managed-demo-thread-trash",
      to: DEMO_MANAGED_EMAIL_ADDRESS,
    }),
  ],
  version: DEMO_MANAGED_MAIL_STATE_VERSION,
});

const isManagedDemoMailState = (
  value: unknown
): value is ManagedDemoMailState => {
  if (typeof value !== "object" || value === null || !("version" in value)) {
    return false;
  }

  return (
    "messages" in value &&
    "labels" in value &&
    value.version === DEMO_MANAGED_MAIL_STATE_VERSION
  );
};

const readDemoState = (): ManagedDemoMailState => {
  if (typeof window === "undefined") {
    return createInitialDemoState();
  }

  const raw = window.localStorage.getItem(DEMO_MANAGED_MAIL_STORAGE_KEY);
  if (raw === null || raw === "") {
    const initial = createInitialDemoState();
    window.localStorage.setItem(
      DEMO_MANAGED_MAIL_STORAGE_KEY,
      JSON.stringify(initial)
    );
    return initial;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isManagedDemoMailState(parsed)) {
      throw new Error("Managed demo state version mismatch.");
    }
    return parsed;
  } catch {
    const initial = createInitialDemoState();
    window.localStorage.setItem(
      DEMO_MANAGED_MAIL_STORAGE_KEY,
      JSON.stringify(initial)
    );
    return initial;
  }
};

const writeDemoState = (state: ManagedDemoMailState) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(
    DEMO_MANAGED_MAIL_STORAGE_KEY,
    JSON.stringify(state)
  );
};

const updateDemoState = (
  updater: (state: ManagedDemoMailState) => ManagedDemoMailState
) => {
  writeDemoState(updater(readDemoState()));
};

const invalidateManagedDemoMail = async (queryClient: QueryClient) => {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["messages", DEMO_MANAGED_MAILBOX_ID],
    }),
    queryClient.invalidateQueries({
      queryKey: [
        "message-thread",
        MANAGED_DEMO_THREAD_QUERY_VERSION,
        DEMO_MANAGED_MAILBOX_ID,
      ],
    }),
    queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
    queryClient.invalidateQueries({
      queryKey: ["managed-label-counts", DEMO_MANAGED_MAILBOX_ID],
    }),
    queryClient.invalidateQueries({
      queryKey: ["gmail-labels", DEMO_MANAGED_MAILBOX_ID],
    }),
  ]);
};

const getSortedMessages = () =>
  readDemoState().messages.toSorted(
    (left, right) =>
      Number(new Date(right.internalDate ?? right.date ?? 0)) -
      Number(new Date(left.internalDate ?? right.date ?? 0))
  );

const getUnreadNonSpamCount = () =>
  readDemoState().messages.filter(
    (message) =>
      isMessageUnread(message) &&
      message.labelIds?.includes(MAILBOX_LABELS.spam) !== true &&
      message.labelIds?.includes(MAILBOX_LABELS.trash) !== true
  ).length;

export const getManagedDemoMailboxes = () => ({
  defaultMailboxId: DEMO_MANAGED_MAILBOX_ID,
  groups: [
    {
      id: "demo-managed-team",
      kind: "organization" as const,
      mailboxes: [
        {
          autoLabelEnabled: false,
          capabilities: getMailboxCapabilities({
            provider: "managed",
            role: "manager",
          }),
          connectionStatus: "connected" as const,
          displayName: "Managed demo",
          emailAddress: DEMO_MANAGED_EMAIL_ADDRESS,
          grantRole: "manager" as const,
          groupId: "demo-managed-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: DEMO_MANAGED_MAILBOX_ID,
          organizationId: "demo-managed-team",
          ownerUserId: null,
          provider: "managed" as const,
          unreadNonSpamCount: getUnreadNonSpamCount(),
          usefulDetailsEnabled: false,
        },
      ],
      name: "Demo",
      slug: "demo-managed-team",
    },
  ],
});

export const listManagedDemoMessages = ({
  category,
  maxResults = 50,
  pageToken,
  query,
}: {
  category: MailboxCategory;
  maxResults?: number;
  pageToken?: string;
  query?: string;
}): ListMessagesPageResult =>
  listDemoMail(getSortedMessages(), {
    category,
    historyId: "managed-demo-history",
    labels: readDemoState().labels,
    maxResults,
    pageToken,
    query,
  });

export const getManagedDemoThread = (threadId: string): ThreadMessagesResult =>
  getDemoMailThread(getSortedMessages(), threadId);
export const getManagedDemoLabels = (): MailboxLabel[] =>
  readDemoState().labels.map((label) => ({
    color: label.color,
    description: label.description,
    id: label.id,
    inclusionCriteria: null,
    name: label.name,
    position: label.position,
    provider: "managed",
    type: "user",
    visible: label.visible,
  }));

export const getManagedDemoLabelCounts = () => {
  const state = readDemoState();
  const counts = new Map<string, Set<string>>();

  for (const message of state.messages) {
    for (const labelId of message.labelIds ?? []) {
      if (DEMO_MANAGED_LABEL_ID_SET.has(labelId)) {
        const threads = counts.get(labelId) ?? new Set<string>();
        threads.add(message.threadId);
        counts.set(labelId, threads);
      }
    }
  }

  return [...counts.entries()].map(([labelId, threadIds]) => ({
    count: threadIds.size,
    labelId,
  }));
};

export const getManagedDemoRules = (): [] => [];

export const getManagedDemoMessageInspector = (
  messageId: string
): MessageInspectorResult => {
  const message = readDemoState().messages.find(
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
    rawText: "Managed demo mode message source is local fixture data.",
    snippet: message?.snippet,
    subject: message?.subject,
    to: message?.to,
  };
};

const store: DemoMessageStore = {
  updateMessages: (update) => {
    updateDemoState((state) => ({
      ...state,
      messages: update(state.messages),
    }));
  },
};
export const createManagedDemoMailboxActions = (queryClient: QueryClient) =>
  createDemoActions(store, async () => {
    await invalidateManagedDemoMail(queryClient);
  });

const composeActions = createDemoComposeActions({
  ...store,
  prefix: "managed-demo",
  sender: DEMO_MANAGED_EMAIL_ADDRESS,
});
export const {
  saveDraft: saveManagedDemoDraft,
  sendDraft: sendManagedDemoDraft,
  deleteDraft: deleteManagedDemoDraft,
} = composeActions;
