"use client";

import type { RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { MailboxSwitcherOrder } from "~/features/navigation/components/mailbox-switcher";
import { getDemoMailboxes } from "~/lib/gmail/demo-mail";
import {
  getMailboxesQueryKey,
  gmailUnreadCountsQueryOptions,
  mailboxesQueryOptions,
} from "~/lib/mailboxes-query";
import { getManagedDemoMailboxes } from "~/lib/managed-mail/demo-managed-mail";
import { orpc } from "~/lib/orpc";

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const emptyPreviewMailboxes = {
  defaultMailboxId: null,
  groups: [],
} as const;

type SandboxMailboxesData =
  | ReturnType<typeof getDemoMailboxes>
  | ReturnType<typeof getManagedDemoMailboxes>
  | typeof emptyPreviewMailboxes;

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
  isEmptyPreviewPersona,
  isDemoMode,
  isManagedDemoMode,
  mailboxId,
  queryClient,
}: {
  isEmptyPreviewPersona: boolean;
  isDemoMode: boolean;
  isManagedDemoMode: boolean;
  mailboxId?: string;
  queryClient: QueryClient;
}) => {
  const isSandboxMode = isDemoMode || isManagedDemoMode || isEmptyPreviewPersona;
  const { data: queriedMailboxesData, isPending: isMailboxesPending } = useQuery(
    mailboxesQueryOptions(!isSandboxMode),
  );
  const sandboxMode = isEmptyPreviewPersona ? "empty" : isManagedDemoMode ? "managed" : "gmail";
  const initialSandboxMailboxesData: SandboxMailboxesData = isEmptyPreviewPersona
    ? emptyPreviewMailboxes
    : isManagedDemoMode
      ? getManagedDemoMailboxes()
      : getDemoMailboxes();
  const { data: sandboxMailboxesData, isPending: areSandboxMailboxesPending } =
    useQuery<SandboxMailboxesData>({
      enabled: isSandboxMode,
      initialData: initialSandboxMailboxesData,
      queryFn: () =>
        isEmptyPreviewPersona
          ? emptyPreviewMailboxes
          : isManagedDemoMode
            ? getManagedDemoMailboxes()
            : getDemoMailboxes(),
      queryKey: [...getMailboxesQueryKey(), "sandbox", sandboxMode],
      refetchOnMount: "always",
      staleTime: Number.POSITIVE_INFINITY,
    });
  const mailboxesData = isSandboxMode ? sandboxMailboxesData : queriedMailboxesData;
  const hasGmailMailbox =
    mailboxesData?.groups.some((group) =>
      group.mailboxes.some((mailbox) => mailbox.provider === "gmail"),
    ) ?? false;
  const { data: gmailUnreadCounts = [] } = useQuery(
    gmailUnreadCountsQueryOptions(!isSandboxMode && hasGmailMailbox),
  );
  const gmailUnreadCountsByMailboxId = new Map(
    gmailUnreadCounts.map((record) => [record.mailboxId, record.unreadNonSpamCount]),
  );
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const mailboxGroups = (mailboxesData?.groups ?? []).map((group) => ({
    id: group.id,
    kind: group.kind,
    name: group.name,
    mailboxes: group.mailboxes.map((mailbox) => ({
      connectionStatus: mailbox.connectionStatus,
      displayName: mailbox.displayName,
      emailAddress: mailbox.emailAddress,
      grantRole: mailbox.grantRole,
      groupName: mailbox.groupName,
      id: mailbox.id,
      provider: mailbox.provider,
      unreadNonSpamCount:
        mailbox.provider === "gmail"
          ? (gmailUnreadCountsByMailboxId.get(mailbox.id) ?? mailbox.unreadNonSpamCount)
          : mailbox.unreadNonSpamCount,
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
    mailboxesQuery: {
      isPending: isSandboxMode ? areSandboxMailboxesPending : isMailboxesPending,
    },
    selectedMailboxId,
    selectedMailboxProvider,
    selectedMailboxNeedsReconnect,
    setDefaultMailboxMutation,
    updateMailboxSwitcherOrderMutation,
  };
};
