import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { getZonedDateTimeFields } from "@quieter/calendar/time";
import type { MessageListItem } from "@quieter/mail/messages";
import { isMailSnoozeLiveStatus } from "@quieter/mail/snooze";
import type {
  MailSnoozeApplyInput,
  MailSnoozeResult,
  MailSnoozeState,
} from "@quieter/mail/snooze";

const snoozeStatusLabels: Record<MailSnoozeState["status"], string> = {
  active: "Returns",
  cancelled: "Return canceled, was due",
  failed: "Snooze needs attention",
  preparing: "Preparing return",
  returned: "Returned, was due",
  returning: "Returning",
  superseded: "Return stopped, was due",
  suspended: "Return paused",
  uncertain: "Return needs attention",
};

export const getMailSnoozeStatusText = (snooze: MailSnoozeState) => {
  const label =
    snooze.status === "active" && isSandboxMailboxId(snooze.mailboxId)
      ? "Preview return"
      : snoozeStatusLabels[snooze.status];
  const time = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: snooze.timeZone,
  }).format(new Date(snooze.returnAt));
  return `${label} ${time} (${snooze.timeZone})${snooze.message ? `, ${snooze.message}` : ""}`;
};

const snoozeRowLabels: Partial<Record<MailSnoozeState["status"], string>> = {
  failed: "Failed",
  preparing: "Preparing",
  returning: "Returning",
  suspended: "Paused",
  uncertain: "Unconfirmed",
};

export const getMailSnoozeRowLabel = (snooze: MailSnoozeState) => {
  const label = snoozeRowLabels[snooze.status];
  if (label !== undefined) {
    return label;
  }
  const { timeZone } = snooze;
  const today = getZonedDateTimeFields({
    instant: new Date().toISOString(),
    timeZone,
  }).date;
  const returnDay = getZonedDateTimeFields({
    instant: snooze.returnAt,
    timeZone,
  }).date;
  const dateFormat: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: returnDay.slice(0, 4) === today.slice(0, 4) ? undefined : "numeric",
  };
  return new Intl.DateTimeFormat(undefined, {
    ...(returnDay === today ? { timeStyle: "short" } : dateFormat),
    timeZone,
  }).format(new Date(snooze.returnAt));
};

export type MailSnoozeAction = "reschedule" | "snooze";

// The server snoozes again after a failed hide and reschedules only settled schedules.
export const getMailSnoozeAction = (
  snooze: MailSnoozeState | undefined,
  messages: readonly MessageListItem[]
): MailSnoozeAction | null => {
  if (snooze?.status === "active" || snooze?.status === "suspended") {
    return "reschedule";
  }
  if (
    snooze !== undefined &&
    snooze.status !== "failed" &&
    isMailSnoozeLiveStatus(snooze.status)
  ) {
    return null;
  }
  return messages.some(
    (message) =>
      (message.threadInboxIncomingMessageIds?.length ?? 0) > 0 ||
      (message.labelIds?.includes("INBOX") === true &&
        !message.labelIds.some((id) =>
          ["SENT", "DRAFT", "SPAM", "TRASH"].includes(id)
        ))
  )
    ? "snooze"
    : null;
};

// Unfinished work by mailbox. Each entry repeats its own frozen requests.
export type MailSnoozeAttempt = Map<string, () => Promise<void>>;

export const resumeMailSnoozeAttempt = async (attempt: MailSnoozeAttempt) => {
  const results = await Promise.allSettled(
    Array.from(attempt.values(), async (resume) => {
      await resume();
    })
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw failure.reason;
  }
};

export type PendingMailSnoozeRequest = {
  openThreadIds: ReadonlySet<string>;
  requestId: string;
  targets: MailSnoozeApplyInput["targets"];
};

// An unconfirmed target repeats the identical request so the server replays it.
// A definite failure needs a new identity, because a replay only returns that failure.
export const settleMailSnoozeRequest = (
  request: PendingMailSnoozeRequest,
  result: MailSnoozeResult
) => {
  const unconfirmedThreadIds = new Set<string>();
  const failedTargets: MailSnoozeApplyInput["targets"] = [];
  const failures = result.targets.filter(
    (target) =>
      target.status === "failed" && request.openThreadIds.has(target.threadId)
  );
  for (const failure of failures) {
    const target = request.targets.find(
      (candidate) => candidate.threadId === failure.threadId
    );
    if (target === undefined) {
      continue;
    }
    if (failure.operationId === undefined) {
      failedTargets.push(target);
    } else if (failure.snooze?.status === "failed") {
      failedTargets.push({
        ...target,
        expectedVersion: failure.snooze.version,
      });
    } else {
      unconfirmedThreadIds.add(target.threadId);
    }
  }
  const pending: PendingMailSnoozeRequest[] = [];
  if (unconfirmedThreadIds.size > 0) {
    pending.push({ ...request, openThreadIds: unconfirmedThreadIds });
  }
  if (failedTargets.length > 0) {
    pending.push({
      openThreadIds: new Set(failedTargets.map((target) => target.threadId)),
      requestId: crypto.randomUUID(),
      targets: failedTargets,
    });
  }
  return { failure: failures.at(0), pending };
};
