import { rpc } from "@quieter/app/lib/orpc";
import type {
  ChangeReminder,
  CreateReminder,
  Reminder,
} from "@quieter/mail/reminders";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export const demoReminderSession = new Map<string, Reminder[]>();

export const reminderListOptions = (
  mailboxId: string,
  view: "active" | "history",
  demo = false
) =>
  queryOptions({
    enabled: mailboxId !== "",
    queryFn: async ({ signal }) => {
      if (demo) {
        return {
          items: (demoReminderSession.get(mailboxId) ?? []).filter((item) =>
            view === "active"
              ? item.status === "active"
              : item.status !== "active"
          ),
          nextCursor: null,
        };
      }
      const items: Reminder[] = [];
      let cursor: string | undefined;
      do {
        const page = await rpc.reminders.list(
          { cursor, mailboxId, view },
          { signal }
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return { items, nextCursor: null };
    },
    queryKey: ["reminders", mailboxId, demo ? "demo" : "remote", view],
    staleTime: 30_000,
  });

export const createUiReminder = async (
  input: CreateReminder,
  demo: boolean
) => {
  if (!demo) {
    return await rpc.reminders.create(input);
  }
  const existing = demoReminderSession.get(input.mailboxId) ?? [];
  const now = new Date().toISOString();
  const reminder: Reminder = {
    ...input,
    createdAt: now,
    evaluationStatus: "none",
    evaluationSummary: null,
    firedAt: null,
    id: input.requestId,
    resolution: null,
    scheduleVersion: 1,
    source: null,
    status: "active",
    updatedAt: now,
    version: 1,
  };
  demoReminderSession.set(input.mailboxId, [...existing, reminder]);
  return reminder;
};

export const changeUiReminder = async (
  input: ChangeReminder,
  demo: boolean
) => {
  if (!demo) {
    return await rpc.reminders.change(input);
  }
  const existing = demoReminderSession.get(input.mailboxId) ?? [];
  const current = existing.find((item) => item.id === input.reminderId);
  if (current === undefined || current.version !== input.expectedVersion) {
    throw new Error("The reminder changed. Refresh and try again.");
  }
  const { command } = input;
  const reminder: Reminder = {
    ...current,
    updatedAt: new Date().toISOString(),
    version: current.version + 1,
  };
  if (command.kind === "edit") {
    Object.assign(reminder, {
      dueAt: command.dueAt,
      firedAt: null,
      scheduleVersion: current.scheduleVersion + 1,
      target: command.target,
      timeZone: command.timeZone,
      title: command.title,
    });
  } else if (command.kind === "snooze") {
    Object.assign(reminder, {
      dueAt: command.dueAt,
      firedAt: null,
      scheduleVersion: current.scheduleVersion + 1,
      timeZone: command.timeZone,
    });
  } else if (command.kind === "complete") {
    reminder.status = "completed";
    reminder.resolution = "user";
  } else if (command.kind === "cancel") {
    reminder.status = "cancelled";
    reminder.resolution = "user";
  } else {
    reminder.status = "active";
    reminder.resolution = null;
    reminder.firedAt = null;
    reminder.scheduleVersion += 1;
  }
  demoReminderSession.set(
    input.mailboxId,
    existing.map((item) => (item.id === reminder.id ? reminder : item))
  );
  return reminder;
};

export const useReminderClock = (
  items: readonly Pick<Reminder, "dueAt">[] | undefined
) => {
  const [now, setNow] = useState(Date.now);
  const boundaries = [
    ...new Set(
      items?.flatMap((item) => [
        Date.parse(item.dueAt) - 30 * 60_000,
        Date.parse(item.dueAt),
      ])
    ),
  ]
    .toSorted((left, right) => left - right)
    .join(",");
  useEffect(() => {
    const deadlines =
      boundaries === "" ? [] : boundaries.split(",").map(Number);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const current = Date.now();
      setNow(current);
      const next = deadlines.find((instant) => instant > current);
      if (next !== undefined) {
        timer = setTimeout(
          refresh,
          Math.min(next - current + 20, 2_147_483_647)
        );
      }
    };
    const frame = requestAnimationFrame(refresh);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [boundaries]);
  return now;
};

export const useReminderList = (
  mailboxId: string,
  view: "active" | "history",
  demo = false
) => {
  const query = useQuery(reminderListOptions(mailboxId, view, demo));
  const now = useReminderClock(query.data?.items);
  return { ...query, now };
};

export const reminderPreferencesOptions = (mailboxId: string) =>
  queryOptions({
    enabled: mailboxId !== "",
    queryFn: async ({ signal }) =>
      await rpc.reminders.preferences({ mailboxId }, { signal }),
    queryKey: ["reminders", mailboxId, "preferences"],
    staleTime: 5 * 60_000,
  });
