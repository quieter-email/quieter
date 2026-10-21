"use client";

import type { MailboxSwitcherOrder } from "@quieter/app/features/navigation/components/mailbox-switcher";
import { toastError } from "@quieter/app/lib/error-toast";
import { getDemoMailboxes } from "@quieter/app/lib/gmail/demo-mail";
import {
  getMailboxesQueryKey,
  gmailUnreadCountsQueryOptions,
  mailboxesQueryOptions,
} from "@quieter/app/lib/mailboxes-query";
import { getManagedDemoMailboxes } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterInputs, RouterOutputs } from "@quieter/orpc";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];

const emptyPreviewMailboxes = {
  defaultMailboxId: null,
  groups: [],
} as const;

type SandboxMailboxesData =
  | ReturnType<typeof getDemoMailboxes>
  | ReturnType<typeof getManagedDemoMailboxes>
  | typeof emptyPreviewMailboxes;

const getSandboxMode = (
  isEmptyPreviewPersona: boolean,
  isManagedDemoMode: boolean
): "empty" | "gmail" | "managed" => {
  if (isEmptyPreviewPersona) {
    return "empty";
  }
  if (isManagedDemoMode) {
    return "managed";
  }
  return "gmail";
};

const getSandboxMailboxes = (
  isEmptyPreviewPersona: boolean,
  isManagedDemoMode: boolean
): SandboxMailboxesData => {
  if (isEmptyPreviewPersona) {
    return emptyPreviewMailboxes;
  }
  if (isManagedDemoMode) {
    return getManagedDemoMailboxes();
  }
  return getDemoMailboxes();
};

const isSandboxMailboxMode = (
  isDemoMode: boolean,
  isManagedDemoMode: boolean,
  isEmptyPreviewPersona: boolean
) => isDemoMode || isManagedDemoMode || isEmptyPreviewPersona;

type MailboxGroup =
  | MailboxesQueryData["groups"][number]
  | SandboxMailboxesData["groups"][number];
type MailboxRecord = MailboxGroup["mailboxes"][number];

const getSignatureHtml = (mailbox: MailboxRecord) =>
  "signatureHtml" in mailbox && typeof mailbox.signatureHtml === "string"
    ? mailbox.signatureHtml
    : null;

const getSignatureText = (mailbox: MailboxRecord) =>
  "signatureText" in mailbox && typeof mailbox.signatureText === "string"
    ? mailbox.signatureText
    : null;

const toMailboxGroup = (
  group: MailboxGroup,
  unreadCounts: ReadonlyMap<string, number>
) => ({
  id: group.id,
  kind: group.kind,
  mailboxes: group.mailboxes.map((mailbox) => ({
    capabilities: mailbox.capabilities,
    connectionStatus: mailbox.connectionStatus,
    displayName: mailbox.displayName,
    divisionName: "divisionName" in mailbox ? mailbox.divisionName : null,
    emailAddress: mailbox.emailAddress,
    grantRole: mailbox.grantRole,
    groupName: mailbox.groupName,
    id: mailbox.id,
    provider: mailbox.provider,
    signatureHtml: getSignatureHtml(mailbox),
    signatureText: getSignatureText(mailbox),
    unreadNonSpamCount:
      mailbox.provider === "gmail"
        ? (unreadCounts.get(mailbox.id) ?? mailbox.unreadNonSpamCount)
        : mailbox.unreadNonSpamCount,
  })),
  name: group.name,
});

const reorderMailboxQueryData = (
  data: MailboxesQueryData,
  order: MailboxSwitcherOrder
): MailboxesQueryData => {
  const groupsById = new Map(data.groups.map((group) => [group.id, group]));
  const orderedGroupIds = order.groupIds.filter((groupId) =>
    groupsById.has(groupId)
  );
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

      const mailboxesById = new Map(
        group.mailboxes.map((mailbox) => [mailbox.id, mailbox])
      );
      const orderedMailboxIds = (
        order.mailboxIdsByGroupId[group.id] ?? []
      ).filter((mailboxId) => mailboxesById.has(mailboxId));
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
  const isSandboxMode = isSandboxMailboxMode(
    isDemoMode,
    isManagedDemoMode,
    isEmptyPreviewPersona
  );
  const { data: queriedMailboxesData, isPending: isMailboxesPending } =
    useQuery(mailboxesQueryOptions(!isSandboxMode));
  const sandboxMode = getSandboxMode(isEmptyPreviewPersona, isManagedDemoMode);
  const initialSandboxMailboxesData = getSandboxMailboxes(
    isEmptyPreviewPersona,
    isManagedDemoMode
  );
  const { data: sandboxMailboxesData, isPending: areSandboxMailboxesPending } =
    useQuery<SandboxMailboxesData>({
      enabled: isSandboxMode,
      initialData: initialSandboxMailboxesData,
      queryFn: () =>
        getSandboxMailboxes(isEmptyPreviewPersona, isManagedDemoMode),
      queryKey: [...getMailboxesQueryKey(), "sandbox", sandboxMode],
      refetchOnMount: "always",
      staleTime: Number.POSITIVE_INFINITY,
    });
  const mailboxesData = isSandboxMode
    ? sandboxMailboxesData
    : queriedMailboxesData;
  const hasGmailMailbox =
    mailboxesData?.groups.some((group) =>
      group.mailboxes.some((mailbox) => mailbox.provider === "gmail")
    ) ?? false;
  const { data: gmailUnreadCounts = [] } = useQuery(
    gmailUnreadCountsQueryOptions(!isSandboxMode && hasGmailMailbox)
  );
  const gmailUnreadCountsByMailboxId = new Map(
    gmailUnreadCounts.map((record) => [
      record.mailboxId,
      record.unreadNonSpamCount,
    ])
  );
  const defaultMailboxId = mailboxesData?.defaultMailboxId ?? null;
  const mailboxGroups = (mailboxesData?.groups ?? []).map((group) =>
    toMailboxGroup(group, gmailUnreadCountsByMailboxId)
  );
  const mailboxes = mailboxGroups.flatMap((group) => group.mailboxes);
  const selectedMailbox =
    mailboxes.find((mailbox) => mailbox.id === mailboxId) ??
    mailboxes.find((mailbox) => mailbox.id === defaultMailboxId) ??
    mailboxes[0] ??
    null;
  const selectedMailboxId = selectedMailbox?.id ?? null;
  const selectedMailboxProvider = selectedMailbox?.provider ?? null;
  const selectedMailboxNeedsReconnect =
    selectedMailbox?.connectionStatus === "needs_reconnect";

  const updateMailboxSwitcherOrderOptions =
    orpc.mail.updateMailboxSwitcherOrder.mutationOptions();
  const updateMailboxSwitcherOrderMutation = useMutation<
    RouterOutputs["mail"]["updateMailboxSwitcherOrder"],
    unknown,
    RouterInputs["mail"]["updateMailboxSwitcherOrder"],
    { previousData: MailboxesQueryData | undefined }
  >({
    mutationFn: updateMailboxSwitcherOrderOptions.mutationFn,
    mutationKey: updateMailboxSwitcherOrderOptions.mutationKey,
    onError: (error, _order, context) => {
      if (
        queryClient.isMutating({
          mutationKey: updateMailboxSwitcherOrderOptions.mutationKey,
        }) === 1 &&
        context !== null &&
        context !== undefined
      ) {
        const queryKey = getMailboxesQueryKey();
        queryClient.setQueryData(queryKey, context.previousData);
      }
      toastError(error, { boundary: "mailbox-order" });
    },
    onMutate: async (order) => {
      const queryKey = getMailboxesQueryKey();
      await queryClient.cancelQueries({ queryKey });

      const previousData =
        queryClient.getQueryData<MailboxesQueryData>(queryKey);
      if (previousData) {
        queryClient.setQueryData<MailboxesQueryData>(
          queryKey,
          reorderMailboxQueryData(previousData, order)
        );
      }

      return { previousData };
    },
    onSettled: async () => {
      if (
        queryClient.isMutating({
          mutationKey: updateMailboxSwitcherOrderOptions.mutationKey,
        }) !== 1
      ) {
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getMailboxesQueryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.mail.listManagedMailboxAdministration.key(),
        }),
      ]);
    },
    scope: { id: "mailbox-switcher-order" },
  });

  return {
    defaultMailboxId,
    mailboxGroups,
    mailboxes,
    mailboxesQuery: {
      isPending: isSandboxMode
        ? areSandboxMailboxesPending
        : isMailboxesPending,
    },
    selectedMailboxId,
    selectedMailboxNeedsReconnect,
    selectedMailboxProvider,
    updateMailboxSwitcherOrderMutation,
  };
};
