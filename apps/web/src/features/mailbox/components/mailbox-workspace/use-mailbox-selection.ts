"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MailboxSwitcherOrder } from "~/features/navigation/components/mailbox-switcher";
import { getDemoMailboxes } from "~/lib/gmail/demo-mail";
import { getMailboxesQueryKey, mailboxesQueryOptions } from "~/lib/mailboxes-query";
import { orpc } from "~/lib/orpc";

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const reorderMailboxQueryData = (
  data: MailboxesQueryData,
  order: MailboxSwitcherOrder,
): MailboxesQueryData => {
  const groupsById = new Map(data.groups.map((group) => [group.id, group]));
  const orderedGroupIds = order.groupIds.filter((groupId) => groupsById.has(groupId));
  const orderedGroupIdsSet = new Set(orderedGroupIds);
  for (const group of data.groups) {
    if (!orderedGroupIdsSet.has(group.id)) {
      orderedGroupIds.push(group.id);
    }
  }

  return {
    ...data,
    groups: orderedGroupIds.flatMap((groupId) => {
      const group = groupsById.get(groupId);
      if (!group) {
        return [];
      }

      const mailboxesById = new Map(group.mailboxes.map((mailbox) => [mailbox.id, mailbox]));
      const orderedMailboxIds = (order.mailboxIdsByGroupId[group.id] ?? []).filter((mailboxId) =>
        mailboxesById.has(mailboxId),
      );
      const orderedMailboxIdsSet = new Set(orderedMailboxIds);
      for (const mailbox of group.mailboxes) {
        if (!orderedMailboxIdsSet.has(mailbox.id)) {
          orderedMailboxIds.push(mailbox.id);
        }
      }

      return [
        {
          ...group,
          mailboxes: orderedMailboxIds.flatMap((mailboxId) => {
            const mailbox = mailboxesById.get(mailboxId);
            return mailbox ? [mailbox] : [];
          }),
        },
      ];
    }),
  };
};

export const useMailboxSelection = ({
  isDemoMode,
  mailboxId,
  queryClient,
}: {
  isDemoMode: boolean;
  mailboxId?: string;
  queryClient: QueryClient;
}) => {
  const mailboxesQuery = useQuery(mailboxesQueryOptions(!isDemoMode));
  const mailboxesData = isDemoMode ? getDemoMailboxes() : mailboxesQuery.data;
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const mailboxGroups = (mailboxesData?.groups ?? []).map((group) => ({
    id: group.id,
    kind: group.kind,
    name: group.name,
    mailboxes: group.mailboxes.map((mailbox) => ({
      connectionStatus: mailbox.connectionStatus,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      groupName: mailbox.groupName,
      id: mailbox.id,
      provider: mailbox.provider,
    })),
  }));
  const mailboxes = mailboxGroups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === mailboxId) ??
    mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedMailboxId = selectedMailbox?.id ?? null;
  const selectedMailboxProvider = selectedMailbox?.provider ?? null;
  const selectedMailboxNeedsReconnect = selectedMailbox?.connectionStatus === "needs_reconnect";

  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });
  const updateMailboxSwitcherOrderMutation = useMutation({
    ...orpc.mail.updateMailboxSwitcherOrder.mutationOptions(),
    onMutate: async (order) => {
      const queryKey = getMailboxesQueryKey();
      await queryClient.cancelQueries({ queryKey });

      const previousData = queryClient.getQueryData<MailboxesQueryData>(queryKey);
      if (previousData) {
        queryClient.setQueryData<MailboxesQueryData>(
          queryKey,
          reorderMailboxQueryData(previousData, order),
        );
      }

      return { previousData };
    },
    onError: async (_error, _order, context) => {
      if (context?.previousData) {
        const queryKey = getMailboxesQueryKey();
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: getMailboxesQueryKey(),
      });
    },
  });

  return {
    defaultMailboxId,
    mailboxGroups,
    mailboxes,
    mailboxesQuery,
    selectedMailboxId,
    selectedMailboxProvider,
    selectedMailboxNeedsReconnect,
    setDefaultMailboxMutation,
    updateMailboxSwitcherOrderMutation,
  };
};
