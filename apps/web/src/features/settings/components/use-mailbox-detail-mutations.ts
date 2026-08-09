import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  getSettingsReturnTo,
  showMutationError,
} from "#/features/settings/components/mailboxes-settings-shared";
import { openGoogleAccountLink } from "#/lib/google-account-link";
import { getMailboxesQueryKey } from "#/lib/mailboxes-query";
import { orpc } from "#/lib/orpc";

export const useMailboxDetailMutations = (
  selectedMailboxId: string | undefined
) => {
  const navigate = useNavigate({ from: "/settings" });
  const queryClient = useQueryClient();
  const [isStartingGmail, setIsStartingGmail] = useState(false);

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
    mutationKey: ["mail", "update-managed-mailbox"],
    onSuccess: async () => {
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
  const setGmailAutoLabelingMutation = useMutation({
    ...orpc.mail.setGmailAutoLabeling.mutationOptions(),
    mutationKey: ["mail", "set-gmail-auto-labeling"],
    onSuccess: async () => {
      await Promise.all([
        invalidateMailboxes(),
        invalidateSelectedManagedMailbox(),
      ]);
    },
  });
  const setGmailUsefulDetailsMutation = useMutation({
    ...orpc.mail.setGmailUsefulDetails.mutationOptions(),
    mutationKey: ["mail", "set-gmail-useful-details"],
    onSuccess: async () => {
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
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start Gmail connection."
      );
    }
  };

  const setDefaultMailbox = (
    nextMailboxId: string,
    defaultMailboxId: string | null
  ) => {
    const isDefault = nextMailboxId === defaultMailboxId;
    setDefaultMailboxMutation.mutate(
      { mailboxId: isDefault ? null : nextMailboxId },
      { onError: showMutationError("Could not update default mailbox.") }
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
    setManagedMailboxDivisionGrantMutation,
    setManagedMailboxGrantMutation,
    startGmailConnection,
    updateManagedMailboxMutation,
  };
};
