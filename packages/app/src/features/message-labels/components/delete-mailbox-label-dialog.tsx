"use client";

import {
  readHiddenLabelIds,
  writeHiddenLabelIds,
} from "@quieter/app/features/message-labels/domain/sidebar-label-visibility";
import {
  getDemoLabelAutomation,
  saveDemoLabelAutomation,
} from "@quieter/app/lib/demo-mail/label-automation";
import { toastError } from "@quieter/app/lib/error-toast";
import { labelOrganizationQueryOptions } from "@quieter/app/lib/mail/label-organization-query";
import { getLabelsQueryKey } from "@quieter/app/lib/mail/labels-query";
import { getManagedLabelCountsQueryKey } from "@quieter/app/lib/managed-mailbox-organization-query";
import { rpc } from "@quieter/app/lib/orpc";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const useDeleteMailboxLabel = ({
  mailboxId,
  mailboxProvider,
  onDeleted,
}: {
  mailboxId: string;
  mailboxProvider: MailboxLabel["provider"];
  onDeleted?: (id: string) => void;
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (labelId: string) => {
      if (isSandboxMailboxId(mailboxId)) {
        const current = getDemoLabelAutomation(mailboxId);
        saveDemoLabelAutomation(mailboxId, {
          ...current,
          deletedLabelIds: [...current.deletedLabelIds, labelId],
        });
      } else {
        await rpc.mail.deleteLabel({ labelId, mailboxId });
      }

      const hiddenLabelIds = readHiddenLabelIds(mailboxId);
      if (hiddenLabelIds.delete(labelId)) {
        writeHiddenLabelIds(mailboxId, hiddenLabelIds);
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: labelOrganizationQueryOptions(mailboxId).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: getLabelsQueryKey(mailboxId),
        }),
        ...(mailboxProvider === "managed"
          ? [
              queryClient.invalidateQueries({
                queryKey: getManagedLabelCountsQueryKey(mailboxId),
              }),
            ]
          : []),
      ]);
    },
    onError: (error) => {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not delete label.",
      });
    },
    onSuccess: (_result, labelId) => {
      onDeleted?.(labelId);
    },
  });
};

export const DeleteMailboxLabelDialog = ({
  label,
  mailboxId,
  mailboxProvider,
  onOpenChange,
  onDeleted,
  open,
}: {
  label: MailboxLabel | null;
  mailboxId: string;
  mailboxProvider: MailboxLabel["provider"];
  onOpenChange: (open: boolean) => void;
  onDeleted?: (id: string) => void;
  open: boolean;
}) => {
  const deleteLabel = useDeleteMailboxLabel({
    mailboxId,
    mailboxProvider,
    onDeleted: (id) => {
      onDeleted?.(id);
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!deleteLabel.isPending) {
          onOpenChange(nextOpen);
        }
      }}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete label</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the label from conversations and automatic rules. Rules
            left without usable settings will be disabled.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogBody>
          <p className="text-body text-fg">
            Delete {label ? `"${label.name}"` : "this label"}?
          </p>
        </AlertDialogBody>
        <AlertDialogFooter>
          <AlertDialogCloseButton
            disabled={deleteLabel.isPending}
            variant="secondary"
          >
            Cancel
          </AlertDialogCloseButton>
          <Button
            disabled={label === null}
            onClick={() => {
              if (label !== null) {
                deleteLabel.mutate(label.id);
              }
            }}
            pending={deleteLabel.isPending}
            pendingLabel="Deleting…"
            variant="destructive"
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
