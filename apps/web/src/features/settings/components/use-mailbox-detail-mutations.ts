import type { RouterOutputs } from "@quieter/orpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { getSettingsReturnTo } from "#/features/settings/components/mailboxes-settings-shared";
import { toastError } from "#/lib/error-toast";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

type MailboxesQueryData = RouterOutputs["mail"]["listMailboxes"];
type ManagedDetailsQueryData =
  RouterOutputs["mail"]["getManagedMailboxDetails"];
/**
 * The fields these toggles write. Declared explicitly because the mailbox list
 * item and the managed detail record are separate shapes that happen to share
 * these keys.
 */
type MailboxFlagPatch = {
  autoLabelEnabled?: boolean;
  divisionId?: string | null;
  includeApiSentMessages?: boolean;
  name?: string;
  usefulDetailsEnabled?: boolean;
};

const getManagedDetailsQueryKey = (mailboxId: string) =>
  ["mail", "managed-mailbox-details", mailboxId] as const;

/**
 * Toggling an intelligence feature is reversible, so the switch moves at once
 * and rolls back if the write fails. Callers must not also disable the control
 * while the mutation is in flight, or the optimistic move is invisible.
 */
const patchMailboxFlag = (
  data: MailboxesQueryData | undefined,
  mailboxId: string,
  patch: MailboxFlagPatch
) =>
  data === undefined
    ? data
    : {
        ...data,
        groups: data.groups.map((group) => ({
          ...group,
          mailboxes: group.mailboxes.map((mailbox) =>
            mailbox.id === mailboxId ? { ...mailbox, ...patch } : mailbox
          ),
        })),
      };

export const useMailboxDetailMutations = (
  selectedMailboxId: string | undefined
) => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const [isStartingGmail, setIsStartingGmail] = useState(false);

  /**
   * Patches both the mailbox list and the managed detail record, because the
   * Gmail and managed views read the same flags from different queries.
   */
  const optimisticMailboxPatch = <TInput extends { mailboxId: string }>(
    toPatch: (input: TInput) => MailboxFlagPatch,
    failureMessage: string
  ) => ({
    onError: (
      error: unknown,
      input: TInput,
      context:
        | {
            previousDetails: ManagedDetailsQueryData | undefined;
            previousList: MailboxesQueryData | undefined;
          }
        | undefined
    ) => {
      queryClient.setQueryData(getMailboxesQueryKey(), context?.previousList);
      queryClient.setQueryData(
        getManagedDetailsQueryKey(input.mailboxId),
        context?.previousDetails
      );
      toastError(error, {
        boundary: "mailbox-settings",
        fallback: failureMessage,
      });
    },
    onMutate: async (input: TInput) => {
      const detailsKey = getManagedDetailsQueryKey(input.mailboxId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: getMailboxesQueryKey() }),
        queryClient.cancelQueries({ queryKey: detailsKey }),
      ]);
      const previousList = queryClient.getQueryData<MailboxesQueryData>(
        getMailboxesQueryKey()
      );
      const previousDetails =
        queryClient.getQueryData<ManagedDetailsQueryData>(detailsKey);
      const patch = toPatch(input);

      queryClient.setQueryData<MailboxesQueryData>(
        getMailboxesQueryKey(),
        (current) => patchMailboxFlag(current, input.mailboxId, patch)
      );
      queryClient.setQueryData<ManagedDetailsQueryData>(
        detailsKey,
        (current) =>
          current === undefined
            ? current
            : { ...current, mailbox: { ...current.mailbox, ...patch } }
      );

      return { previousDetails, previousList };
    },
  });

  const invalidateMailboxes = async () => {
    await queryClient.invalidateQueries({ queryKey: getMailboxesQueryKey() });
  };
  const invalidateSelectedManagedMailbox = async () => {
    if ((selectedMailboxId ?? "") === "") {
      return;
    }
    await queryClient.invalidateQueries({
      queryKey: ["mail", "managed-mailbox-details", selectedMailboxId],
    });
  };

  const disconnectMailboxMutation = useMutation({
    ...orpc.mail.disconnectMailbox.mutationOptions(),
    mutationKey: ["mail", "disconnect-mailbox"],
    onSuccess: async () => {
      await invalidateMailboxes();
      await navigate({
        replace: true,
        search: (previous) => ({ ...previous, mailboxId: "" }),
        to: ".",
      });
    },
  });
  const moveGmailMailboxMutation = useMutation({
    ...orpc.mail.moveGmailMailbox.mutationOptions(),
    mutationKey: ["mail", "move-gmail-mailbox"],
    onSuccess: invalidateMailboxes,
  });
  const setDefaultMailboxMutation = useMutation({
    ...orpc.mail.setDefaultMailbox.mutationOptions(),
    mutationKey: ["mail", "set-default-mailbox"],
    onSuccess: invalidateMailboxes,
  });
  const updateManagedMailboxMutation = useMutation({
    ...orpc.mail.updateManagedMailbox.mutationOptions(),
    ...optimisticMailboxPatch(
      ({ mailboxId: _mailboxId, ...patch }) => patch,
      "Could not update mailbox."
    ),
    mutationKey: ["mail", "update-managed-mailbox"],
    onSettled: async () => {
      await Promise.all([
        invalidateMailboxes(),
        invalidateSelectedManagedMailbox(),
      ]);
    },
  });
  const setManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const removeManagedMailboxGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const setManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.setManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-division-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const removeManagedMailboxDivisionGrantMutation = useMutation({
    ...orpc.mail.removeManagedMailboxDivisionGrant.mutationOptions(),
    mutationKey: ["mail", "remove-managed-mailbox-division-grant"],
    onSuccess: invalidateSelectedManagedMailbox,
  });
  const setManagedMailboxAccessModeMutation = useMutation({
    ...orpc.mail.setManagedMailboxAccessMode.mutationOptions(),
    mutationKey: ["mail", "set-managed-mailbox-access-mode", selectedMailboxId],
    onError: (error) => {
      toastError(error, {
        boundary: "mailbox-settings",
        fallback: "Could not change mailbox access.",
      });
    },
    onSettled: async (_data, _error, input) => {
      await Promise.all([
        invalidateMailboxes(),
        queryClient.invalidateQueries({
          queryKey: getManagedDetailsQueryKey(input.mailboxId),
        }),
      ]);
    },
  });
  const setGmailAutoLabelingMutation = useMutation({
    ...orpc.mail.setGmailAutoLabeling.mutationOptions(),
    ...optimisticMailboxPatch(
      (input: { enabled: boolean; mailboxId: string }) => ({
        autoLabelEnabled: input.enabled,
      }),
      "Could not update auto-labeling."
    ),
    mutationKey: ["mail", "set-gmail-auto-labeling"],
    onSettled: async () => {
      await Promise.all([
        invalidateMailboxes(),
        invalidateSelectedManagedMailbox(),
      ]);
    },
  });
  const setGmailUsefulDetailsMutation = useMutation({
    ...orpc.mail.setGmailUsefulDetails.mutationOptions(),
    ...optimisticMailboxPatch(
      (input: { enabled: boolean; mailboxId: string }) => ({
        usefulDetailsEnabled: input.enabled,
      }),
      "Could not update useful details."
    ),
    mutationKey: ["mail", "set-gmail-useful-details"],
    onSettled: async () => {
      await Promise.all([
        invalidateMailboxes(),
        invalidateSelectedManagedMailbox(),
      ]);
    },
  });

  const startGmailConnection = async (input?: {
    mailboxId?: string;
    organizationId?: string;
    organizations: { id: string }[];
  }) => {
    setIsStartingGmail(true);
    try {
      await openGoogleAccountLink({
        mailboxId: input?.mailboxId,
        organizationId:
          input?.organizationId ?? input?.organizations[0]?.id ?? "",
        queryClient,
        returnTo: getSettingsReturnTo(input?.mailboxId),
      });
    } catch (error) {
      setIsStartingGmail(false);
      toastError(error, {
        boundary: "gmail-connect",
        fallback: "Could not start Gmail connection.",
      });
    }
  };

  const setDefaultMailbox = (
    nextMailboxId: string,
    defaultMailboxId: string | null
  ) => {
    const isDefault = nextMailboxId === defaultMailboxId;
    setDefaultMailboxMutation.mutate(
      { mailboxId: isDefault ? null : nextMailboxId },
      {
        onError: (error) => {
          toastError(error, {
            boundary: "mailbox-settings",
            fallback: "Could not update default mailbox.",
          });
        },
      }
    );
  };

  return {
    disconnectMailboxMutation,
    isStartingGmail,
    moveGmailMailboxMutation,
    removeManagedMailboxDivisionGrantMutation,
    removeManagedMailboxGrantMutation,
    setDefaultMailbox,
    setDefaultMailboxMutation,
    setGmailAutoLabelingMutation,
    setGmailUsefulDetailsMutation,
    setManagedMailboxAccessModeMutation,
    setManagedMailboxDivisionGrantMutation,
    setManagedMailboxGrantMutation,
    startGmailConnection,
    updateManagedMailboxMutation,
  };
};
