import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "@quieter/app/lib/demo-mail/label-automation";
import { toastError } from "@quieter/app/lib/error-toast";
import { getLabelsQueryKey } from "@quieter/app/lib/mail/labels-query";
import { getManagedLabelCountsQueryKey } from "@quieter/app/lib/managed-mailbox-organization-query";
import { rpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import { mailboxLabelSchema } from "@quieter/mail/mailbox-organization";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { mutationOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { createStore } from "@tanstack/react-store";

type LabelChange =
  | { kind: "name"; name: MailboxLabel["name"] }
  | { kind: "color"; color: MailboxLabelColor }
  | { kind: "visibility"; visible: MailboxLabel["visible"] };

type LabelUpdate = { labelId: MailboxLabel["id"]; change: LabelChange };
type LabelFields = Partial<Pick<MailboxLabel, "name" | "color" | "visible">>;

const createLabelUpdates = (
  queryClient: QueryClient,
  mailboxId: string,
  mailboxProvider: MailboxLabel["provider"]
) => {
  const queryKey = getLabelsQueryKey(mailboxId);
  const mutationKey = ["label-update", mailboxId];
  const { queryHash } = queryClient.defaultQueryOptions({ queryKey });
  const state = createStore<{
    confirmed: Map<string, LabelFields>;
    pending: LabelUpdate[];
  }>({ confirmed: new Map(), pending: [] });

  queryClient.getQueryCache().subscribe((event) => {
    const current = state.get();
    if (
      current.confirmed.size === 0 ||
      current.pending.length > 0 ||
      event.type !== "updated" ||
      event.action.type !== "success" ||
      event.action.manual === true ||
      event.query.queryHash !== queryHash ||
      queryClient.isMutating({ mutationKey }) > 0
    ) {
      return;
    }
    state.setState(() => ({ confirmed: new Map(), pending: [] }));
  });

  return {
    options: mutationOptions({
      mutationFn: async (update: LabelUpdate): Promise<MailboxLabel> => {
        const label = queryClient
          .getQueryData<MailboxLabel[]>(queryKey)
          ?.find((entry) => entry.id === update.labelId);
        if (!label) {
          throw new Error("Label is no longer available.");
        }
        const { kind, ...patch } = update.change;
        const name =
          kind === "name"
            ? update.change.name
            : (state.get().confirmed.get(label.id)?.name ?? label.name);

        if (isSandboxMailboxId(mailboxId)) {
          const current = getDemoLabelAutomation(mailboxId);
          const updated = {
            ...label,
            ...current.updatedLabels[label.id],
            ...patch,
            name,
          };
          saveDemoLabelAutomation(mailboxId, {
            ...current,
            updatedLabels: { ...current.updatedLabels, [label.id]: updated },
          });
          return updated;
        }

        return mailboxLabelSchema.parse(
          await rpc.mail.updateLabel({
            ...patch,
            labelId: label.id,
            mailboxId,
            name,
          })
        );
      },
      mutationKey,
      onError: (error, update) => {
        state.setState((current) => ({
          ...current,
          pending: current.pending.filter((entry) => entry !== update),
        }));
        toastError(error, {
          boundary: "labels-panel",
          fallback: "Could not update label. Please try again.",
        });
      },
      onMutate: async (update) => {
        state.setState((current) => ({
          ...current,
          pending: [...current.pending, update],
        }));
        await queryClient.cancelQueries({ queryKey });
      },
      onSettled: async () => {
        if (state.get().pending.length > 0) {
          return;
        }
        try {
          await queryClient.cancelQueries({ queryKey });
          await Promise.all([
            queryClient.invalidateQueries(
              { queryKey, refetchType: "all" },
              { throwOnError: true }
            ),
            ...(mailboxProvider === "managed"
              ? [
                  queryClient.invalidateQueries({
                    queryKey: getManagedLabelCountsQueryKey(mailboxId),
                  }),
                ]
              : []),
          ]);
          if (state.get().pending.length === 0) {
            state.setState(() => ({ confirmed: new Map(), pending: [] }));
          }
        } catch (error) {
          toastError(error, { boundary: "labels-panel" });
        }
      },
      onSuccess: async (label, update) => {
        let patch: LabelFields;
        switch (update.change.kind) {
          case "name": {
            patch = { name: label.name };
            break;
          }
          case "color": {
            patch = { color: label.color };
            break;
          }
          case "visibility": {
            patch = { visible: label.visible };
            break;
          }
          default: {
            const exhaustive: never = update.change;
            throw new Error("Unknown label change.", { cause: exhaustive });
          }
        }
        state.setState((current) => ({
          confirmed: new Map(current.confirmed).set(label.id, {
            ...current.confirmed.get(label.id),
            ...patch,
          }),
          pending: current.pending.filter((entry) => entry !== update),
        }));
        await queryClient.cancelQueries({ queryKey });
        queryClient.setQueryData<MailboxLabel[]>(queryKey, (labels) =>
          labels?.map((entry) =>
            entry.id === label.id ? { ...entry, ...patch } : entry
          )
        );
      },
      scope: { id: JSON.stringify(["label-update", mailboxId]) },
    }),
    project: (
      labels: MailboxLabel[],
      { confirmed, pending }: ReturnType<typeof state.get>
    ) =>
      labels.map((label) => {
        const projected = { ...label, ...confirmed.get(label.id) };
        for (const update of pending) {
          if (update.labelId === label.id) {
            const { kind: _kind, ...patch } = update.change;
            Object.assign(projected, patch);
          }
        }
        return projected;
      }),
    state,
  };
};

const labelUpdatesByClient = new WeakMap<
  QueryClient,
  Map<string, ReturnType<typeof createLabelUpdates>>
>();

export const getLabelUpdates = ({
  queryClient,
  mailboxId,
  mailboxProvider,
}: {
  queryClient: QueryClient;
  mailboxId: string;
  mailboxProvider: MailboxLabel["provider"];
}) => {
  let mailboxes = labelUpdatesByClient.get(queryClient);
  if (!mailboxes) {
    mailboxes = new Map();
    labelUpdatesByClient.set(queryClient, mailboxes);
  }
  let updates = mailboxes.get(mailboxId);
  if (!updates) {
    updates = createLabelUpdates(queryClient, mailboxId, mailboxProvider);
    mailboxes.set(mailboxId, updates);
  }
  return updates;
};
