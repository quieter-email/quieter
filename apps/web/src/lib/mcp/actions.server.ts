import { call, getRouter, isProcedure, ORPCError, unlazy } from "@orpc/server";
import type { UnlaziedRouter } from "@orpc/server";
import type { OrpcContext } from "@quieter/orpc/context";
import { appRouter } from "@quieter/orpc/router";
import { z } from "zod";

export type ActionPolicy =
  | "automation"
  | "read"
  | "write"
  | "delete"
  | "bulk_delete"
  | "send"
  | "mail_change";
type ActionSpec = readonly [policy: ActionPolicy, description: string];

type Actions = {
  [Domain in keyof typeof appRouter]: Record<
    keyof UnlaziedRouter<typeof appRouter>[Domain],
    ActionSpec
  >;
};

export const orpcActions = {
  accountPreferences: {
    get: ["read", "Read account time and date preferences."],
    update: ["write", "Set account time format or first day of the week."],
  },
  ai: {
    deleteMemory: ["bulk_delete", "Delete all personal AI memory."],
    exportMemory: ["read", "Export personal AI memory."],
    forgetMemories: ["bulk_delete", "Forget AI memories in bulk."],
    forgetMemory: ["delete", "Forget one AI memory by ID."],
    interactMemory: ["write", "Record feedback on an AI memory."],
    interpretSearchQuery: [
      "read",
      "Turn a natural-language mail query into structured search filters.",
    ],
    learnFromMail: ["write", "Learn from selected messages in a mailbox."],
    memories: ["read", "Find personal AI memories."],
    resetPersonalization: [
      "bulk_delete",
      "Reset AI personalization and learning history.",
    ],
    saveMemory: ["write", "Save an AI memory."],
    settings: ["read", "Read AI settings."],
    suggestReply: [
      "read",
      "Generate reply suggestions for a mail conversation.",
    ],
    updateLearningGuidance: ["write", "Update instructions for AI learning."],
    updatePersonalization: ["write", "Update AI personalization settings."],
  },
  billing: {
    createCheckout: ["write", "Create a checkout URL for the user to open."],
    createPortal: [
      "write",
      "Create a billing portal URL for the user to open.",
    ],
    overview: ["read", "Read plan, usage, balance, and billing access."],
    syncCheckout: ["write", "Refresh the status of a completed checkout."],
    takeOverBilling: ["write", "Take over funding for a team you own."],
    updateAccountUsageSettings: [
      "write",
      "Set account overage and monthly spending limits.",
    ],
  },
  calendar: {
    accounts: ["read", "List connected calendar accounts."],
    calendars: ["read", "List calendars on a connected account."],
    colors: ["read", "List event colors for a calendar."],
    create: ["write", "Create an event on a calendar."],
    delete: ["delete", "Delete a specific calendar event."],
    event: ["read", "Read a calendar event."],
    events: ["read", "List events in a date range."],
    importInvitation: ["write", "Import an invitation from a mail message."],
    respond: [
      "write",
      "Respond to a calendar invitation. This may notify attendees.",
    ],
    update: ["write", "Edit a calendar event."],
    updateColor: ["write", "Change a calendar event's color."],
  },
  chat: {
    cancel: ["write", "Stop a running Quieter chat response."],
    delete: ["delete", "Delete a Quieter chat."],
    get: ["read", "Read a Quieter chat and its messages."],
    list: ["read", "List Quieter chats."],
    rename: ["write", "Rename a Quieter chat."],
    reply: [
      "write",
      "Ask Quieter about a mailbox. Use a new messageId UUID for each turn and the same chatId to continue a chat.",
    ],
    transcribeAudio: ["read", "Transcribe a base64 audio recording."],
  },
  connectors: {
    disconnect: [
      "mail_change",
      "Disconnect a connected app account. Supply its connectionId. Omitting it disconnects every account for the provider.",
    ],
    list: ["read", "List supported apps and current connections."],
    startConnection: [
      "write",
      "Get the Quieter settings URL to connect an app in the browser.",
    ],
  },
  mail: {
    applyChanges: [
      "mail_change",
      "Mark exact messages read or important, archive them as Done, change labels, or move them to Trash. Supports permanent deletion.",
    ],
    applySnooze: [
      "write",
      "Snooze a conversation or bring it back to the inbox.",
    ],
    cancelManagedRuleBackfill: [
      "write",
      "Stop applying a managed mailbox rule to existing mail.",
    ],
    createLabel: ["write", "Create a mailbox label."],
    createManagedMailbox: [
      "write",
      "Create a managed mailbox on a team domain.",
    ],
    createManagedMailboxForApiMessage: [
      "write",
      "Create a managed mailbox for a transactional sender.",
    ],
    createManagedRule: ["mail_change", "Create a rule for a managed mailbox."],
    createUpdateConnection: [
      "write",
      "Create a connection for live mailbox updates.",
    ],
    deleteDraft: ["delete", "Delete one saved draft."],
    deleteLabel: ["delete", "Delete a mailbox label."],
    deleteManagedMailbox: [
      "bulk_delete",
      "Delete a managed mailbox and its mail.",
    ],
    deleteManagedRule: ["delete", "Delete a managed mailbox rule."],
    disconnectMailbox: ["bulk_delete", "Disconnect a Gmail mailbox."],
    dismissGmailUsefulDetail: [
      "write",
      "Dismiss a detail extracted from a Gmail message.",
    ],
    getAttachment: [
      "read",
      "Download a specific attachment from its mailbox and message.",
    ],
    getComposeSendStatus: [
      "read",
      "Check a draft or message send operation by ID.",
    ],
    getDraft: ["read", "Read a saved draft and attachment references."],
    getHeldSend: ["read", "Read a send that can still be undone."],
    getMailCaptureStatus: [
      "read",
      "Check mailbox indexing and capture status.",
    ],
    getManagedMailboxDetails: [
      "read",
      "Read a managed mailbox's settings and access.",
    ],
    getManagedRuleBackfill: [
      "read",
      "Check progress applying a rule to existing mail.",
    ],
    getMessageDelivery: [
      "read",
      "Read delivery details for a message in a mailbox.",
    ],
    getMessageInspector: ["read", "Inspect a message's headers and metadata."],
    getThread: [
      "read",
      "Read a conversation and its full message bodies. Use the mailboxId and threadId from listThreads.",
    ],
    listGmailThreadUsefulDetails: [
      "read",
      "Read extracted details for a Gmail conversation.",
    ],
    listGmailUnreadCounts: ["read", "Get Gmail unread counts."],
    listGmailUsefulDetails: ["read", "List extracted details from Gmail."],
    listLabels: ["read", "List mailbox labels and their IDs."],
    listMailboxes: [
      "read",
      "List Gmail, managed, and transactional mailboxes you can access.",
    ],
    listManagedLabelCounts: [
      "read",
      "Count messages in each managed mailbox label.",
    ],
    listManagedMailboxAdministration: [
      "read",
      "List managed mailboxes you can administer.",
    ],
    listManagedRules: ["read", "List rules for a managed mailbox."],
    listMessageDeliveryStatuses: [
      "read",
      "Look up delivery status for selected message IDs.",
    ],
    listThreads: [
      "read",
      "Search or browse one Gmail, managed, or transactional mailbox. Pass query, category, and optional pageToken.",
    ],
    listVerificationCodes: [
      "read",
      "Find verification codes received in a mailbox.",
    ],
    markMessageAsRead: ["write", "Mark a specific message read."],
    markMessageAsUnread: ["write", "Mark a specific message unread."],
    markThreadAsRead: ["write", "Mark a conversation read."],
    markThreadAsUnread: ["write", "Mark a conversation unread."],
    moveGmailMailbox: ["write", "Change which team funds a Gmail mailbox."],
    moveMessageToTrash: ["delete", "Move one message to Trash."],
    moveThreadToTrash: [
      "bulk_delete",
      "Move every message in a conversation to Trash. Use applyChanges with exact message IDs for a small explicit request.",
    ],
    previewManagedRule: [
      "read",
      "Preview which messages match a managed rule.",
    ],
    previewUnsubscribe: [
      "read",
      "Read the exact unsubscribe email a mailing list requests.",
    ],
    removeManagedMailboxDivisionGrant: [
      "delete",
      "Remove a division's managed mailbox access.",
    ],
    removeManagedMailboxGrant: [
      "delete",
      "Remove a member's managed mailbox access.",
    ],
    reorderManagedLabels: ["write", "Reorder a managed mailbox's labels."],
    reorderManagedRules: ["write", "Reorder a managed mailbox's rules."],
    saveDraft: ["write", "Save or edit a draft without sending it."],
    sendDraft: [
      "send",
      "Send a draft with the full message content and a new sendOperationId UUID.",
    ],
    sendMessage: [
      "send",
      "Send a new mail message, reply, or forward with a new sendOperationId UUID.",
    ],
    setDefaultMailbox: ["write", "Set the default mailbox."],
    setGmailAutoLabeling: ["write", "Change automatic labeling for Gmail."],
    setGmailUsefulDetailFeedback: [
      "write",
      "Give feedback on a detail extracted from Gmail.",
    ],
    setGmailUsefulDetails: [
      "write",
      "Change automatic extraction of useful details from Gmail.",
    ],
    setManagedMailboxAccessMode: [
      "write",
      "Set how team members access a managed mailbox.",
    ],
    setManagedMailboxDivisionGrant: [
      "write",
      "Set a division's managed mailbox access.",
    ],
    setManagedMailboxGrant: ["write", "Set a member's managed mailbox access."],
    startGmailConnection: [
      "write",
      "Create a browser URL for the user to connect Gmail.",
    ],
    startManagedRuleBackfill: [
      "mail_change",
      "Apply a managed mailbox rule to existing mail.",
    ],
    syncMailbox: ["read", "Read mailbox changes since a specific revision."],
    undoSend: ["write", "Undo a send during its hold period."],
    unsubscribeFromMessage: [
      "send",
      "Unsubscribe using the sender's list-unsubscribe instructions.",
    ],
    untrashMessage: ["write", "Restore a message from Trash."],
    untrashThread: ["write", "Restore a conversation from Trash."],
    updateGmailMailboxDisplayName: [
      "write",
      "Rename a Gmail mailbox in Quieter.",
    ],
    updateLabel: ["write", "Rename or recolor a mailbox label."],
    updateLabelDetails: [
      "write",
      "Edit a label's details or automatic labeling settings.",
    ],
    updateMailboxSignature: ["write", "Set a mailbox signature."],
    updateMailboxSwitcherOrder: [
      "write",
      "Reorder accounts and groups in the mailbox switcher.",
    ],
    updateManagedMailbox: [
      "write",
      "Edit a managed mailbox's address or settings.",
    ],
    updateManagedRule: ["mail_change", "Edit a managed mailbox rule."],
    updateMessageLabels: [
      "mail_change",
      "Add or remove labels on a message. Use applyChanges for moves to Trash.",
    ],
    updateThreadLabels: [
      "mail_change",
      "Add or remove labels on a conversation. Use applyChanges for moves to Trash.",
    ],
  },
  mailAgent: {
    activate: ["write", "Enable the incoming-mail agent for a mailbox."],
    get: ["read", "Read incoming-mail agent settings."],
    pause: ["write", "Pause a mailbox's incoming-mail agent."],
    review: ["write", "Record feedback on the incoming-mail agent's result."],
    run: ["write", "Run the incoming-mail agent on selected mail."],
    threadResults: [
      "read",
      "Read incoming-mail agent results for a conversation.",
    ],
  },
  mailDomains: {
    checkSetup: [
      "write",
      "Check current domain DNS records and update verification status.",
    ],
    createSetup: ["write", "Add a mail domain and return its DNS setup."],
    get: ["read", "Read a domain's status and DNS records."],
    getDomainConnectAvailability: [
      "read",
      "Check whether a domain supports automatic DNS setup.",
    ],
    list: ["read", "List mail domains for a team."],
    remove: [
      "bulk_delete",
      "Remove a team's mail domain and its configuration.",
    ],
    setCatchAll: ["write", "Set or clear the catch-all mailbox on a domain."],
    startDomainConnect: [
      "write",
      "Get a browser URL to authorize automatic DNS setup.",
    ],
    updateMode: ["write", "Change what types of mail a domain handles."],
  },
  mailSnippets: {
    create: ["write", "Create a reusable mail snippet."],
    delete: ["delete", "Delete a mail snippet."],
    list: ["read", "List reusable mail snippets."],
    update: ["write", "Edit a mail snippet."],
  },
  onboarding: {
    complete: ["write", "Complete account onboarding with the user's choices."],
    getState: ["read", "Read account onboarding progress."],
  },
  operations: {
    access: ["read", "Check access to the platform operations console."],
    overview: [
      "read",
      "Read the platform operations overview. Requires platform admin.",
    ],
    setWaitlistOpen: [
      "write",
      "Set the platform waitlist state. Requires platform admin.",
    ],
    settings: [
      "read",
      "Read platform waitlist settings. Requires platform admin.",
    ],
  },
  organization: {
    createDivision: ["write", "Create a division within a team."],
    deleteDivision: ["delete", "Delete a team division."],
    getMailDeliveryMetrics: [
      "read",
      "Read transactional delivery metrics for a team.",
    ],
    getMailTrackingSettings: ["read", "Read team mail tracking settings."],
    listDivisions: ["read", "List divisions and their membership in a team."],
    listMailRecipientSuppressions: [
      "read",
      "List suppressed recipients using team account permissions.",
    ],
    listMailSuppressionAudit: [
      "read",
      "Read the team's suppression change history.",
    ],
    reconcileMailMessageDelivery: [
      "write",
      "Refresh a team's transactional delivery status.",
    ],
    setDivisionMembers: ["write", "Replace the members of a team division."],
    setMailTrackingSettings: ["write", "Update mail tracking for a team."],
    suppressMailRecipient: [
      "write",
      "Suppress delivery to a recipient for a team.",
    ],
    unsuppressMailRecipient: [
      "delete",
      "Remove a recipient from a team's suppression list.",
    ],
    updateDivision: ["write", "Edit a team division."],
  },
  organizationMailUsage: {
    overview: ["read", "Read a team's mail usage and limits."],
    updateSettings: ["write", "Set a team's mail usage options."],
  },
  reminders: {
    acceptSuggestion: [
      "write",
      "Create a reminder from a suggested follow-up.",
    ],
    change: ["write", "Complete, reschedule, or change a reminder."],
    create: ["write", "Set a reminder for a date or conversation."],
    dismissSuggestion: ["write", "Dismiss a follow-up reminder suggestion."],
    get: ["read", "Read one reminder."],
    list: ["read", "List reminders in a mailbox."],
    preferences: ["read", "Read reminder preferences."],
    suggestion: ["read", "Read a suggested follow-up reminder."],
    updatePreferences: ["write", "Change reminder preferences."],
  },
  scheduledSends: {
    cancel: [
      "write",
      "Cancel a queued send and restore the draft when available.",
    ],
    create: [
      "send",
      "Schedule a full message using a new sendOperationId UUID.",
    ],
    getByOperation: ["read", "Look up a scheduled send by operation ID."],
    list: ["read", "List queued and failed scheduled sends for a mailbox."],
    recoverAttempt: [
      "write",
      "Look up an uncertain scheduling attempt and recover if it was abandoned.",
    ],
    reschedule: ["write", "Change the time of an already scheduled message."],
  },
  search: {
    history: ["read", "Search available mail history across a mailbox."],
    pause: ["write", "Pause mail history indexing."],
    prepareMail: ["write", "Prepare a mailbox for history search."],
    status: ["read", "Check readiness for mail history search."],
  },
} satisfies Actions;

export const resolveOrpcAction = async (name: string) => {
  const { default: procedure } = await unlazy(
    getRouter(appRouter, name.split("."))
  );
  if (!isProcedure(procedure)) {
    throw new Error(`Missing MCP procedure ${name}.`);
  }
  const schema: unknown = procedure["~orpc"].inputSchema;
  if (schema !== undefined && !(schema instanceof z.ZodType)) {
    throw new Error(`Unsupported MCP input schema for ${name}.`);
  }
  return {
    run: async (input: unknown, context: OrpcContext): Promise<unknown> =>
      await call(procedure, schema === undefined ? undefined : input, {
        context,
        signal: context.signal,
      }),
    schema: schema ?? z.strictObject({}),
  };
};

export const parseActionInput = (schema: z.ZodType, input: unknown) => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ORPCError("BAD_REQUEST", {
      message: z.prettifyError(parsed.error),
    });
  }
  return parsed.data;
};
