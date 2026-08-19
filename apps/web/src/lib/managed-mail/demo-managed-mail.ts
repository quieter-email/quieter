import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import type { MailSearchFilter } from "@quieter/mail/search";
import type { QueryClient } from "@tanstack/react-query";

import { clientEnv } from "#/env";
import type { ComposeDraftState } from "#/features/compose/domain/draft";
import { parseStructuredSearchQuery } from "#/features/message-search/state/message-list-search-state";
import {
  addUnreadLabel,
  applyLabelIdChanges,
  isMessageUnread,
  isMessageInMailbox,
  MAILBOX_LABELS,
  removeUnreadLabel,
} from "#/lib/gmail/gmail";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageInspectorResult,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/gmail/gmail";
import type { ThreadListEntry } from "#/lib/gmail/thread-list";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";

export const DEMO_MANAGED_MAILBOX_ID = "demo:managed-mailbox";
const DEMO_MANAGED_EMAIL_ADDRESS = "support@quieter.com";
const DEMO_MANAGED_MAIL_STORAGE_KEY = "quieter:managed-demo-mail-state";
const DEMO_MANAGED_MAIL_STATE_VERSION = 2;
const MANAGED_DEMO_THREAD_QUERY_VERSION = 3;

const hasText = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim() !== "";

export const DEMO_MANAGED_LABEL_IDS = {
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
  savedViews: ManagedDemoSavedView[];
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

type ManagedDemoSavedView = {
  color: MailboxLabelColor | null;
  icon: string | null;
  id: string;
  name: string;
  ownerUserId: string | null;
  position: number;
  search: {
    filters: { type: string; value: string }[];
    text: string;
  };
  sort: "newest" | "oldest" | "relevance";
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
  messageHeaderId: `<${id}@managed-demo.quieter.local>`,
  senderAvatarUrls:
    fields.senderAvatarUrls ?? getDemoSenderAvatarUrls(fields.from),
  threadId: fields.threadId ?? id,
  ...fields,
});

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
        "<p>Hi,</p><p>Sharing the latest label and saved view counts from local fixtures.</p><p>This message is outbound-only for Sent view testing.</p>",
      bodyText:
        "Hi,\n\nSharing the latest label and saved view counts from local fixtures.\n\nThis message is outbound-only for Sent view testing.",
      date: daysAgo(2),
      from: DEMO_MANAGED_EMAIL_ADDRESS,
      isUnread: false,
      labelIds: labelIds(MAILBOX_LABELS.sent),
      snippet:
        "Sharing the latest label and saved view counts from local fixtures.",
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
  savedViews: [
    {
      color: "orange",
      icon: null,
      id: "demo-managed-saved-view-unread-support",
      name: "Unread support",
      ownerUserId: null,
      position: 0,
      search: {
        filters: [
          { type: "is", value: "unread" },
          { type: "label", value: "Support" },
        ],
        text: "",
      },
      sort: "newest",
    },
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
    "savedViews" in value &&
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
      queryKey: ["managed-saved-views", DEMO_MANAGED_MAILBOX_ID],
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

const textMatchesQuery = (value: string | null | undefined, query: string) =>
  value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ?? false;

const parseRelativeSearchDuration = (value: string) => {
  const match = /^(?<amount>\d+)(?<unit>[dmy])$/u.exec(
    value.trim().toLocaleLowerCase()
  );
  if (match?.groups?.amount === undefined || match.groups.unit === undefined) {
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

const getFilterTargets = (
  message: MessageListItem
): Record<string, (string | null | undefined)[]> => ({
  bcc: [message.bcc],
  cc: [message.cc],
  content: [message.bodyText, message.snippet],
  filename: message.attachments?.map((attachment) => attachment.fileName) ?? [],
  from: [message.from],
  subject: [message.subject],
  to: [message.to],
});

const matchesDateFilter = (
  message: MessageListItem,
  filter: MailSearchFilter
) => {
  const filterTime = new Date(filter.value).getTime();
  if (Number.isNaN(filterTime)) {
    return false;
  }

  const messageTime = getMessageTime(message);
  return filter.type === "after"
    ? messageTime > filterTime
    : messageTime < filterTime;
};

const matchesRelativeDateFilter = (
  message: MessageListItem,
  filter: MailSearchFilter
) => {
  const duration = parseRelativeSearchDuration(filter.value);
  if (duration === null) {
    return false;
  }

  const isOlder = Date.now() - getMessageTime(message) > duration;
  return filter.type === "older_than" ? isOlder : !isOlder;
};

const matchesIsFilter = (
  message: MessageListItem,
  filter: MailSearchFilter,
  messageLabelIds: ReadonlySet<string>
) => {
  switch (filter.value) {
    case "unread": {
      return isMessageUnread(message);
    }
    case "read": {
      return !isMessageUnread(message);
    }
    case "spam": {
      return messageLabelIds.has(MAILBOX_LABELS.spam);
    }
    case "trash": {
      return messageLabelIds.has(MAILBOX_LABELS.trash);
    }
    default: {
      return true;
    }
  }
};

const matchesTextFilter = (
  message: MessageListItem,
  filter: MailSearchFilter
) => {
  const targets = getFilterTargets(message)[filter.type];
  return (
    targets === undefined ||
    targets.some((target) => textMatchesQuery(target, filter.value))
  );
};

const matchesStructuredFilter = (
  message: MessageListItem,
  filter: MailSearchFilter,
  labelsByName: ReadonlyMap<string, string>,
  messageLabelIds: ReadonlySet<string>
) => {
  switch (filter.type) {
    case "after": {
      return matchesDateFilter(message, filter);
    }
    case "before": {
      return matchesDateFilter(message, filter);
    }
    case "older_than": {
      return matchesRelativeDateFilter(message, filter);
    }
    case "newer_than": {
      return matchesRelativeDateFilter(message, filter);
    }
    case "has": {
      return (message.attachments?.length ?? 0) > 0;
    }
    case "is": {
      return matchesIsFilter(message, filter, messageLabelIds);
    }
    case "label": {
      const labelId = labelsByName.get(filter.value.toLocaleLowerCase());
      return hasText(labelId) && messageLabelIds.has(labelId);
    }
    case "bcc": {
      return matchesTextFilter(message, filter);
    }
    case "cc": {
      return matchesTextFilter(message, filter);
    }
    case "content": {
      return matchesTextFilter(message, filter);
    }
    case "filename": {
      return matchesTextFilter(message, filter);
    }
    case "from": {
      return matchesTextFilter(message, filter);
    }
    case "header": {
      return matchesTextFilter(message, filter);
    }
    case "subject": {
      return matchesTextFilter(message, filter);
    }
    case "to": {
      return matchesTextFilter(message, filter);
    }
    default: {
      return false;
    }
  }
};

const matchesSearchText = (
  message: MessageListItem,
  text: string | undefined
) => {
  if (text === undefined || text === "") {
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
  return haystack.includes(text.toLowerCase());
};

const messageMatchesQuery = (
  message: MessageListItem,
  query: string | undefined
) => {
  if ((query ?? "") === "") {
    return true;
  }

  const state = readDemoState();
  const labelsByName = new Map(
    state.labels.map((label) => [label.name.toLocaleLowerCase(), label.id])
  );
  const messageLabelIds = new Set(message.labelIds);
  const structuredQuery = parseStructuredSearchQuery(query ?? "");

  for (const filter of structuredQuery.filters) {
    if (
      !matchesStructuredFilter(message, filter, labelsByName, messageLabelIds)
    ) {
      return false;
    }
  }

  return matchesSearchText(message, structuredQuery.text);
};

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
}): ListMessagesPageResult => {
  const start = (pageToken ?? "") === "" ? 0 : Number(pageToken) || 0;
  const allMessages = getSortedMessages();
  const threadLabelIdsById = new Map<string, Set<string>>();
  for (const message of allMessages) {
    const threadLabelIds =
      threadLabelIdsById.get(message.threadId) ?? new Set<string>();
    for (const labelId of message.labelIds ?? []) {
      threadLabelIds.add(labelId);
    }
    threadLabelIdsById.set(message.threadId, threadLabelIds);
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
    historyId: "managed-demo-history",
    messages: page,
    nextPageToken:
      nextOffset < messages.length ? String(nextOffset) : undefined,
    resultSizeEstimate: messages.length,
  };
};

export const getManagedDemoThread = (
  threadId: string
): ThreadMessagesResult => {
  const messages = getSortedMessages().filter(
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

export const getManagedDemoSavedViews = () => readDemoState().savedViews;

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

const updateMessages = (
  predicate: (message: MessageListItem) => boolean,
  update: (message: MessageListItem) => MessageListItem
) => {
  updateDemoState((state) => ({
    ...state,
    messages: state.messages.map((message) =>
      predicate(message) ? update(message) : message
    ),
  }));
};

const removeMessages = (predicate: (message: MessageListItem) => boolean) => {
  updateDemoState((state) => ({
    ...state,
    messages: state.messages.filter((message) => !predicate(message)),
  }));
};

const getThreadIdForItem = (itemId: string) =>
  readDemoState().messages.find((message) => message.id === itemId)?.threadId ??
  itemId;

const markManagedDemoThreadReadState = async (
  queryClient: QueryClient,
  threadId: string,
  unread: boolean
) => {
  updateMessages(
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      isUnread: unread,
      labelIds: unread
        ? addUnreadLabel(message.labelIds)
        : removeUnreadLabel(message.labelIds),
    })
  );
  await invalidateManagedDemoMail(queryClient);
};

const updateManagedDemoThreadLabels = async (
  queryClient: QueryClient,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) => {
  updateMessages(
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      labelIds: applyLabelIdChanges(message.labelIds, changes),
    })
  );
  await invalidateManagedDemoMail(queryClient);
};

const removeManagedDemoThread = async (
  queryClient: QueryClient,
  threadId: string
) => {
  removeMessages((message) => message.threadId === threadId);
  await invalidateManagedDemoMail(queryClient);
};

const markItemReadState = async (
  queryClient: QueryClient,
  itemId: string,
  unread: boolean
) => {
  await markManagedDemoThreadReadState(
    queryClient,
    getThreadIdForItem(itemId),
    unread
  );
};

const updateItemLabels = async (
  queryClient: QueryClient,
  itemId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
) => {
  await updateManagedDemoThreadLabels(
    queryClient,
    getThreadIdForItem(itemId),
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

export const createManagedDemoMailboxActions = (queryClient: QueryClient) => ({
  archiveMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, archiveChanges);
  },
  archiveThread: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, archiveChanges);
  },
  archiveThreads: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateManagedDemoThreadLabels(
          queryClient,
          thread.threadId,
          archiveChanges
        );
      })
    );
  },
  deleteDraft: async (message: MessageListItem) => {
    await removeManagedDemoThread(queryClient, message.threadId);
  },
  deleteDrafts: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await removeManagedDemoThread(queryClient, thread.threadId);
      })
    );
  },
  markMessageAsRead: async (messageId: string) => {
    await markItemReadState(queryClient, messageId, false);
  },
  markMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, markAsSpamChanges);
  },
  markMessageAsUnread: async (messageId: string) => {
    await markItemReadState(queryClient, messageId, true);
  },
  markThreadAsRead: async (threadId: string) => {
    await markManagedDemoThreadReadState(queryClient, threadId, false);
  },
  markThreadAsSpam: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      markAsSpamChanges
    );
  },
  markThreadAsUnread: async (threadId: string) => {
    await markManagedDemoThreadReadState(queryClient, threadId, true);
  },
  markThreadsAsRead: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await markManagedDemoThreadReadState(
          queryClient,
          thread.threadId,
          false
        );
      })
    );
  },
  markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateManagedDemoThreadLabels(
          queryClient,
          thread.threadId,
          markAsSpamChanges
        );
      })
    );
  },
  markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await markManagedDemoThreadReadState(
          queryClient,
          thread.threadId,
          true
        );
      })
    );
  },
  moveMessageToInboxFromSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromSpamChanges);
  },
  moveMessageToInboxFromTrash: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromTrashChanges);
  },
  moveMessageToTrash: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToTrashChanges);
  },
  moveThreadToInboxFromSpam: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      moveToInboxFromSpamChanges
    );
  },
  moveThreadToInboxFromTrash: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      moveToInboxFromTrashChanges
    );
  },
  moveThreadToTrash: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      moveToTrashChanges
    );
  },
  moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateManagedDemoThreadLabels(
          queryClient,
          thread.threadId,
          moveToTrashChanges
        );
      })
    );
  },
  unmarkMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromSpamChanges);
  },
  unmarkThreadAsSpam: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      moveToInboxFromSpamChanges
    );
  },
  unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateManagedDemoThreadLabels(
          queryClient,
          thread.threadId,
          moveToInboxFromSpamChanges
        );
      })
    );
  },
  unsubscribeFromMessage: async () => {
    await Promise.resolve();
  },
  untrashMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromTrashChanges);
  },
  untrashThread: async (threadId: string) => {
    await updateManagedDemoThreadLabels(
      queryClient,
      threadId,
      moveToInboxFromTrashChanges
    );
  },
  untrashThreads: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map(async (thread) => {
        await updateManagedDemoThreadLabels(
          queryClient,
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
    await updateItemLabels(queryClient, messageId, changes);
  },
  updateThreadLabels: async (
    threadId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] }
  ) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, changes);
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
        await updateManagedDemoThreadLabels(queryClient, threadId, changes);
      })
    );
  },
});

export const saveManagedDemoDraft = async (
  draft: ComposeDraftState
): Promise<ComposeDraftState> => {
  const messageId =
    draft.messageId ?? `managed-demo-draft-message-${draft.localId}`;
  const draftId = draft.draftId ?? `managed-demo-draft-${draft.localId}`;
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
    from: DEMO_MANAGED_EMAIL_ADDRESS,
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

  return await Promise.resolve(savedDraft);
};

export const sendManagedDemoDraft = (draft: ComposeDraftState) => {
  const messageId = `managed-demo-sent-${crypto.randomUUID()}`;
  const sentMessage = createMessage(messageId, {
    bodyHtml: draft.bodyHtml,
    bodyText: draft.bodyText,
    date: new Date().toISOString(),
    from: DEMO_MANAGED_EMAIL_ADDRESS,
    isUnread: false,
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

export const deleteManagedDemoDraft = (draft: ComposeDraftState) => {
  if ((draft.messageId ?? "") === "") {
    return;
  }
  removeMessages((message) => message.id === draft.messageId);
};

export const resetManagedDemoMail = () => {
  writeDemoState(createInitialDemoState());
};
