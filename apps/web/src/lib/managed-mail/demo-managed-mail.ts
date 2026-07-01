import type { MailboxLabel, MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { QueryClient } from "@tanstack/react-query";
import type { ComposeDraftState } from "~/features/compose";
import type { ThreadListEntry } from "~/lib/gmail/thread-list";
import { parseStructuredSearchQuery } from "~/features/message-search/state/message-list-search-state";
import {
  addUnreadLabel,
  applyLabelIdChanges,
  isMessageUnread,
  isMessageInMailbox,
  MAILBOX_LABELS,
  removeUnreadLabel,
  type ListMessagesPageResult,
  type MailboxCategory,
  type MessageInspectorResult,
  type MessageListItem,
  type ThreadMessagesResult,
} from "~/lib/gmail/gmail";
import { getMailboxThreadQueriesKey } from "~/lib/gmail/thread-query";
import { getMailboxesQueryKey } from "~/lib/mailboxes-query";
import {
  getManagedLabelCountsQueryKey,
  getManagedSavedViewsQueryKey,
} from "~/lib/managed-mailbox-organization-query";

export const DEMO_MANAGED_MAILBOX_ID = "demo:managed-mailbox";
const DEMO_MANAGED_EMAIL_ADDRESS = "support@dev.quieter.test";
const DEMO_MANAGED_MAIL_STORAGE_KEY = "quieter:managed-demo-mail-state";
const DEMO_MANAGED_MAIL_STATE_VERSION = 1;

export const DEMO_MANAGED_LABEL_IDS = {
  billing: "demo-managed-label-billing",
  support: "demo-managed-label-support",
  vip: "demo-managed-label-vip",
} as const;
const DEMO_MANAGED_LABEL_ID_SET = new Set<string>(Object.values(DEMO_MANAGED_LABEL_IDS));

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
    filters: Array<{ type: string; value: string }>;
    text: string;
  };
  sort: "newest" | "oldest" | "relevance";
};

const now = Date.now();
const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

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

const createMessage = (
  id: string,
  fields: Omit<MessageListItem, "id" | "threadId" | "messageHeaderId" | "internalDate"> & {
    threadId?: string;
  },
): MessageListItem => ({
  id,
  threadId: fields.threadId ?? id,
  messageHeaderId: `<${id}@managed-demo.quieter.local>`,
  internalDate: fields.date ?? daysAgo(0),
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
      from: "Jordan Lee <jordan@acme.example>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.support,
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
      to: "Jordan Lee <jordan@acme.example>",
    }),
    createMessage("managed-demo-msg-3", {
      bodyHtml:
        "<p>Hello,</p><p>Please confirm receipt of invoice 4821 and let us know the expected payment date.</p><p>Regards,<br>Accounts Payable</p>",
      bodyText:
        "Hello,\n\nPlease confirm receipt of invoice 4821 and let us know the expected payment date.\n\nRegards,\nAccounts Payable",
      date: daysAgo(1.1),
      from: "Accounts Payable <ap@vendor.example>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.billing,
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
      from: "Morgan Ellis <morgan@partner.example>",
      labelIds: labelIds(
        MAILBOX_LABELS.inbox,
        MAILBOX_LABELS.unread,
        DEMO_MANAGED_LABEL_IDS.support,
        DEMO_MANAGED_LABEL_IDS.vip,
      ),
      snippet: "We need the managed mailbox live before the partner launch on Monday.",
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
      snippet: "Sharing the latest label and saved view counts from local fixtures.",
      subject: "Weekly managed mail summary",
      threadId: "managed-demo-thread-sent",
      to: "Onboarding <onboarding@quieter.example>",
    }),
    createMessage("managed-demo-msg-6", {
      bodyHtml: "<p>Claim your reward immediately.</p>",
      bodyText: "Claim your reward immediately.",
      date: daysAgo(3),
      from: "Prize Desk <winner@spam.example>",
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
      from: "Old Thread <old@example.com>",
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

const readDemoState = (): ManagedDemoMailState => {
  if (typeof window === "undefined") {
    return createInitialDemoState();
  }

  const raw = window.localStorage.getItem(DEMO_MANAGED_MAIL_STORAGE_KEY);
  if (!raw) {
    const initial = createInitialDemoState();
    window.localStorage.setItem(DEMO_MANAGED_MAIL_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  try {
    const parsed = JSON.parse(raw) as ManagedDemoMailState;
    if (parsed.version !== DEMO_MANAGED_MAIL_STATE_VERSION) {
      throw new Error("Managed demo state version mismatch.");
    }
    return parsed;
  } catch {
    const initial = createInitialDemoState();
    window.localStorage.setItem(DEMO_MANAGED_MAIL_STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }
};

const writeDemoState = (state: ManagedDemoMailState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_MANAGED_MAIL_STORAGE_KEY, JSON.stringify(state));
};

const updateDemoState = (updater: (state: ManagedDemoMailState) => ManagedDemoMailState) => {
  writeDemoState(updater(readDemoState()));
};

const invalidateManagedDemoMail = async (queryClient: QueryClient) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["messages", DEMO_MANAGED_MAILBOX_ID] }),
    queryClient.invalidateQueries({
      queryKey: getMailboxThreadQueriesKey(DEMO_MANAGED_MAILBOX_ID),
    }),
    queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() }),
    queryClient.invalidateQueries({
      queryKey: getManagedLabelCountsQueryKey(DEMO_MANAGED_MAILBOX_ID),
    }),
    queryClient.invalidateQueries({
      queryKey: getManagedSavedViewsQueryKey(DEMO_MANAGED_MAILBOX_ID),
    }),
    queryClient.invalidateQueries({ queryKey: ["gmail-labels", DEMO_MANAGED_MAILBOX_ID] }),
  ]);
};

const getSortedMessages = () =>
  readDemoState().messages.toSorted(
    (left, right) =>
      Number(new Date(right.internalDate ?? right.date ?? 0)) -
      Number(new Date(left.internalDate ?? right.date ?? 0)),
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

  const state = readDemoState();
  const labelsByName = new Map(
    state.labels.map((label) => [label.name.toLocaleLowerCase(), label.id]),
  );
  const messageLabelIds = new Set(message.labelIds ?? []);
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
      const labelId = labelsByName.get(filter.value.toLocaleLowerCase());
      if (!labelId || !messageLabelIds.has(labelId)) {
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

export const getManagedDemoMailboxes = () => ({
  defaultMailboxId: DEMO_MANAGED_MAILBOX_ID,
  groups: [
    {
      id: "demo-managed-team",
      kind: "organization" as const,
      name: "Demo",
      slug: "demo-managed-team",
      mailboxes: [
        {
          connectionStatus: "connected" as const,
          displayName: "Managed demo",
          emailAddress: DEMO_MANAGED_EMAIL_ADDRESS,
          grantRole: "manager" as const,
          gmailAutoLabelEnabled: false,
          gmailUsefulDetailsEnabled: false,
          groupId: "demo-managed-team",
          groupKind: "organization" as const,
          groupName: "Demo",
          id: DEMO_MANAGED_MAILBOX_ID,
          organizationId: "demo-managed-team",
          ownerUserId: null,
          provider: "managed" as const,
        },
      ],
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
  const start = pageToken ? Number(pageToken) || 0 : 0;
  const messages = getSortedMessages().filter(
    (message) => isMessageInMailbox(message, category) && messageMatchesQuery(message, query),
  );
  const page = messages.slice(start, start + maxResults);
  const nextOffset = start + maxResults;

  return {
    historyId: "managed-demo-history",
    messages: page,
    nextPageToken: nextOffset < messages.length ? String(nextOffset) : undefined,
    resultSizeEstimate: messages.length,
  };
};

export const getManagedDemoThread = (threadId: string): ThreadMessagesResult => {
  const messages = getSortedMessages().filter((message) => message.threadId === threadId);

  return {
    messages,
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

export const getManagedDemoMessageInspector = (messageId: string): MessageInspectorResult => {
  const message = readDemoState().messages.find((entry) => entry.id === messageId);

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
    rawText: "Managed demo mode message source is local fixture data.",
    snippet: message?.snippet,
    subject: message?.subject,
    to: message?.to,
  };
};

const updateMessages = (
  predicate: (message: MessageListItem) => boolean,
  update: (message: MessageListItem) => MessageListItem,
) => {
  updateDemoState((state) => ({
    ...state,
    messages: state.messages.map((message) => (predicate(message) ? update(message) : message)),
  }));
};

const removeMessages = (predicate: (message: MessageListItem) => boolean) => {
  updateDemoState((state) => ({
    ...state,
    messages: state.messages.filter((message) => !predicate(message)),
  }));
};

const getThreadIdForItem = (itemId: string) =>
  readDemoState().messages.find((message) => message.id === itemId)?.threadId ?? itemId;

const markItemReadState = async (queryClient: QueryClient, itemId: string, unread: boolean) => {
  await markManagedDemoThreadReadState(queryClient, getThreadIdForItem(itemId), unread);
};

const updateItemLabels = async (
  queryClient: QueryClient,
  itemId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
) => {
  await updateManagedDemoThreadLabels(queryClient, getThreadIdForItem(itemId), changes);
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
      threads.map((thread) =>
        updateManagedDemoThreadLabels(queryClient, thread.threadId, archiveChanges),
      ),
    );
  },
  deleteDraft: async (message: MessageListItem) => {
    await removeManagedDemoThread(queryClient, message.threadId);
  },
  deleteDrafts: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) => removeManagedDemoThread(queryClient, thread.threadId)),
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
    await updateManagedDemoThreadLabels(queryClient, threadId, markAsSpamChanges);
  },
  markThreadsAsRead: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) => markManagedDemoThreadReadState(queryClient, thread.threadId, false)),
    );
  },
  markThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateManagedDemoThreadLabels(queryClient, thread.threadId, markAsSpamChanges),
      ),
    );
  },
  markThreadsAsUnread: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) => markManagedDemoThreadReadState(queryClient, thread.threadId, true)),
    );
  },
  markThreadAsUnread: async (threadId: string) => {
    await markManagedDemoThreadReadState(queryClient, threadId, true);
  },
  moveMessageToTrash: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToTrashChanges);
  },
  moveThreadToTrash: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, moveToTrashChanges);
  },
  moveThreadsToTrash: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateManagedDemoThreadLabels(queryClient, thread.threadId, moveToTrashChanges),
      ),
    );
  },
  moveMessageToInboxFromSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromSpamChanges);
  },
  moveThreadToInboxFromSpam: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, moveToInboxFromSpamChanges);
  },
  unmarkMessageAsSpam: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromSpamChanges);
  },
  unmarkThreadAsSpam: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, moveToInboxFromSpamChanges);
  },
  unmarkThreadsAsSpam: async (threads: ThreadListEntry[]) => {
    await Promise.all(
      threads.map((thread) =>
        updateManagedDemoThreadLabels(queryClient, thread.threadId, moveToInboxFromSpamChanges),
      ),
    );
  },
  moveMessageToInboxFromTrash: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromTrashChanges);
  },
  moveThreadToInboxFromTrash: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, moveToInboxFromTrashChanges);
  },
  unsubscribeFromMessage: async () => {},
  untrashMessage: async (messageId: string) => {
    await updateItemLabels(queryClient, messageId, moveToInboxFromTrashChanges);
  },
  untrashThread: async (threadId: string) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, moveToInboxFromTrashChanges);
  },
  updateMessageLabels: async (
    messageId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => {
    await updateItemLabels(queryClient, messageId, changes);
  },
  updateThreadLabels: async (
    threadId: string,
    changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
  ) => {
    await updateManagedDemoThreadLabels(queryClient, threadId, changes);
  },
});

const markManagedDemoThreadReadState = async (
  queryClient: QueryClient,
  threadId: string,
  unread: boolean,
) => {
  updateMessages(
    (message) => message.threadId === threadId,
    (message) => ({
      ...message,
      isUnread: unread,
      labelIds: unread ? addUnreadLabel(message.labelIds) : removeUnreadLabel(message.labelIds),
    }),
  );
  await invalidateManagedDemoMail(queryClient);
};

const updateManagedDemoThreadLabels = async (
  queryClient: QueryClient,
  threadId: string,
  changes: { addLabelIds?: string[]; removeLabelIds?: string[] },
) => {
  updateMessages(
    (message) => message.threadId === threadId,
    (message) => ({ ...message, labelIds: applyLabelIdChanges(message.labelIds, changes) }),
  );
  await invalidateManagedDemoMail(queryClient);
};

const removeManagedDemoThread = async (queryClient: QueryClient, threadId: string) => {
  removeMessages((message) => message.threadId === threadId);
  await invalidateManagedDemoMail(queryClient);
};

export const saveManagedDemoDraft = async (
  draft: ComposeDraftState,
): Promise<ComposeDraftState> => {
  const messageId = draft.messageId ?? `managed-demo-draft-message-${draft.localId}`;
  const draftId = draft.draftId ?? `managed-demo-draft-${draft.localId}`;
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
    from: DEMO_MANAGED_EMAIL_ADDRESS,
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

export const sendManagedDemoDraft = async (draft: ComposeDraftState) => {
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
        (entry) => entry.id !== draft.messageId && entry.draftId !== draft.draftId,
      ),
      sentMessage,
    ],
  }));

  return { id: sentMessage.id, threadId: sentMessage.threadId };
};

export const deleteManagedDemoDraft = async (draft: ComposeDraftState) => {
  if (!draft.messageId) return;
  removeMessages((message) => message.id === draft.messageId);
};

export const resetManagedDemoMail = () => {
  writeDemoState(createInitialDemoState());
};
