import { toastError } from "@quieter/app/lib/error-toast";
import type { ChangeReminder, Reminder } from "@quieter/mail/reminders";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { changeUiReminder } from "./reminder-query";

type ReminderPage = { items: Reminder[]; nextCursor: string | null };
type ReminderRollback = {
  before: { key: readonly unknown[]; row: Reminder }[];
  detail: Reminder | null | undefined;
  detailKey: readonly unknown[];
  optimistic: Reminder;
} | null;

export const cacheReminder = ({
  client,
  reminder,
  demo,
}: {
  client: QueryClient;
  reminder: Reminder;
  demo: boolean;
}) => {
  const mode = demo ? "demo" : "remote";
  for (const [key] of client.getQueriesData<ReminderPage>({
    queryKey: ["reminders", reminder.mailboxId, mode],
  })) {
    if (key[2] !== mode || (key[3] !== "active" && key[3] !== "history")) {
      continue;
    }
    const active =
      reminder.status === "active" || reminder.status === "suspended";
    const belongs = key[3] === "active" ? active : !active;
    client.setQueryData<ReminderPage>(key, (page) => {
      if (!page) {
        return page;
      }
      const exists = page.items.some((item) => item.id === reminder.id);
      return {
        ...page,
        items: [
          ...page.items
            .filter((item) => item.id !== reminder.id || belongs)
            .map((item) => (item.id === reminder.id ? reminder : item)),
          ...(belongs && !exists ? [reminder] : []),
        ],
      };
    });
  }
  client.setQueryData(
    ["reminders", reminder.mailboxId, mode, "detail", reminder.id],
    reminder
  );
};

export const useReminderMutation = ({
  reminder,
  demo,
}: {
  reminder: Reminder;
  demo: boolean;
}) => {
  const client = useQueryClient();
  const mode = demo ? "demo" : "remote";
  const mutationKey = [
    "reminder-mutation",
    reminder.mailboxId,
    mode,
    reminder.id,
  ];
  const pending = useIsMutating({ mutationKey });
  const mutation = useMutation<
    Reminder,
    unknown,
    ChangeReminder["command"],
    ReminderRollback
  >({
    mutationFn: async (command: ChangeReminder["command"]) =>
      await changeUiReminder(
        {
          command,
          expectedVersion: reminder.version,
          mailboxId: reminder.mailboxId,
          reminderId: reminder.id,
        },
        demo
      ),
    mutationKey,
    onError: (error, _, context) => {
      if (context) {
        for (const { key, row } of context.before) {
          client.setQueryData<ReminderPage>(key, (page) =>
            page
              ? {
                  ...page,
                  items: page.items.map((item) =>
                    item.id === row.id &&
                    item.version === context.optimistic.version &&
                    item.status === context.optimistic.status &&
                    item.dueAt === context.optimistic.dueAt &&
                    item.firedAt === context.optimistic.firedAt &&
                    item.timeZone === context.optimistic.timeZone
                      ? row
                      : item
                  ),
                }
              : page
          );
        }
        const previous = context.detail;
        if (previous) {
          client.setQueryData<Reminder | null>(context.detailKey, (item) =>
            item?.id === previous.id &&
            item.version === context.optimistic.version &&
            item.status === context.optimistic.status &&
            item.dueAt === context.optimistic.dueAt &&
            item.firedAt === context.optimistic.firedAt &&
            item.timeZone === context.optimistic.timeZone
              ? previous
              : item
          );
        }
      }
      toastError(error, {
        boundary: "reminder-change",
        fallback: "Could not update the reminder. Please try again.",
      });
    },
    onMutate: async (command) => {
      await client.cancelQueries({
        queryKey: ["reminders", reminder.mailboxId, mode],
      });
      const optimistic: Reminder = { ...reminder };
      if (command.kind === "complete") {
        optimistic.status = "completed";
      } else if (command.kind === "cancel") {
        optimistic.status = "cancelled";
      } else if (command.kind === "snooze") {
        optimistic.dueAt = command.dueAt;
        optimistic.timeZone = command.timeZone;
        optimistic.firedAt = null;
      } else {
        return null;
      }
      const before: { key: readonly unknown[]; row: Reminder }[] = [];
      for (const [key, page] of client.getQueriesData<ReminderPage>({
        queryKey: ["reminders", reminder.mailboxId, mode],
      })) {
        if (key[2] !== mode || (key[3] !== "active" && key[3] !== "history")) {
          continue;
        }
        const row = page?.items.find((item) => item.id === reminder.id);
        if (!row) {
          continue;
        }
        before.push({ key, row });
        client.setQueryData<ReminderPage>(key, (current) =>
          current
            ? {
                ...current,
                items: current.items.map((item) =>
                  item.id === reminder.id ? optimistic : item
                ),
              }
            : current
        );
      }
      const detailKey = [
        "reminders",
        reminder.mailboxId,
        mode,
        "detail",
        reminder.id,
      ];
      const detail = client.getQueryData<Reminder | null>(detailKey);
      if (detail) {
        client.setQueryData(detailKey, optimistic);
      }
      return { before, detail, detailKey, optimistic };
    },
    onSettled: async () => {
      if (
        client.isMutating({
          mutationKey: ["reminder-mutation", reminder.mailboxId, mode],
        }) === 1
      ) {
        await Promise.all([
          client.invalidateQueries({
            queryKey: ["reminders", reminder.mailboxId, mode],
          }),
          client.invalidateQueries({
            queryKey: ["reminder-suggestion", reminder.mailboxId],
          }),
        ]);
      }
    },
    onSuccess: (result) => {
      cacheReminder({ client, demo, reminder: result });
    },
  });
  return {
    error: mutation.error,
    isPending: pending > 0,
    mutate: (
      command: ChangeReminder["command"],
      options?: Parameters<typeof mutation.mutate>[1]
    ) => {
      if (client.isMutating({ mutationKey }) === 0) {
        mutation.mutate(command, options);
      }
    },
  };
};
