"use client";

import type { ComposeHeldReceipt } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import { toastError } from "@quieter/app/lib/error-toast";
import { getMessagesQueryKey } from "@quieter/app/lib/mail/inbox-query/index";
import { orpc, rpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";

import { HeldSendNotice } from "../../compose/components/held-send-notice";
import { useAgentWorkspace } from "../domain/workspace-context";

export const ChatHeldSend = ({ receipt }: { receipt: ComposeHeldReceipt }) => {
  const { mailboxId, sendOperationId, draftId, draftRevision } = receipt;
  const workspace = useAgentWorkspace();
  const queryClient = useQueryClient();
  const queryOptions = orpc.mail.getHeldSend.queryOptions({
    input: { mailboxId, sendOperationId },
  });
  const held = useQuery({
    ...queryOptions,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "preparing" ||
        status === "held" ||
        status === "dispatching"
        ? 1000
        : false;
    },
  });
  const applyHeldStatus = useCallback(
    async (status: RouterOutputs["mail"]["getHeldSend"] | undefined) => {
      if (
        status === null ||
        status === undefined ||
        workspace?.mailboxId !== mailboxId ||
        status.mailboxId !== mailboxId ||
        status.sendOperationId !== sendOperationId
      ) {
        return;
      }
      await workspace.getCompose()?.applyHeldReceipt({
        canUndo: status.canUndo,
        draftId,
        draftRevision,
        mailboxId,
        restoredDraftId: status.draftId,
        sendOperationId,
        status: status.status,
        undoUntil: status.undoUntil,
      });
    },
    [draftId, draftRevision, mailboxId, sendOperationId, workspace]
  );
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await applyHeldStatus(held.data);
      } catch (error) {
        if (active) {
          toastError(error, { boundary: "assistant-held-receipt" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [applyHeldStatus, held.data]);
  const checkDelivery = async () => {
    try {
      const current = await held.refetch({ throwOnError: true });
      await applyHeldStatus(current.data);
    } catch (error) {
      toastError(error, { boundary: "assistant-check-delivery" });
    }
  };
  const undo = useMutation({
    mutationFn: async () =>
      await rpc.mail.undoSend({ mailboxId, sendOperationId }),
    onError: (error) => {
      toastError(error, { boundary: "assistant-undo-send" });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryOptions.queryKey }),
        queryClient.invalidateQueries({
          queryKey: getMessagesQueryKey(mailboxId, "drafts").slice(0, 3),
        }),
      ]);
    },
  });
  const needsDraftRecovery =
    held.data?.status === "failed" ||
    (held.data?.status === "canceled" && held.data.draftId === null);
  return (
    <div>
      <HeldSendNotice held={held.data} />
      {held.isError ? (
        <p className="px-4 pb-2 text-body-sm text-muted-fg">
          Could not check this send attempt. Try again.
        </p>
      ) : null}
      <div className="px-4 pb-2">
        <ActionFooter>
          {held.data?.canUndo === true ? (
            <Button
              variant="secondary"
              size="sm"
              pending={undo.isPending}
              onClick={() => {
                undo.mutate();
              }}
            >
              Undo send
            </Button>
          ) : null}
          <Button
            variant={needsDraftRecovery ? "secondary" : "default"}
            size="sm"
            pending={held.isFetching}
            onClick={() => {
              void checkDelivery();
            }}
          >
            Check delivery
          </Button>
          {needsDraftRecovery ? (
            <Button
              size="sm"
              pending={undo.isPending}
              onClick={() => {
                undo.mutate();
              }}
            >
              Return to Drafts
            </Button>
          ) : null}
        </ActionFooter>
      </div>
    </div>
  );
};
