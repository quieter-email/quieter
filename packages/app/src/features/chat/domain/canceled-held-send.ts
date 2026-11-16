import type { ComposeHeldReceipt } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import type { RouterOutputs } from "@quieter/orpc";

export type CanceledHeldSendCapture = Pick<
  ComposeHeldReceipt,
  "draftId" | "draftRevision" | "mailboxId" | "sendOperationId"
> & {
  assistantMessageId: string;
  chatId: string;
  userId: string;
};

type HeldSendStatus = RouterOutputs["mail"]["getHeldSend"];

export const recoverCanceledHeldSend = async (input: {
  cancel: () => Promise<unknown>;
  capture: CanceledHeldSendCapture | null;
  isCurrent: () => boolean;
  readStatus: (
    scope: Pick<CanceledHeldSendCapture, "mailboxId" | "sendOperationId">
  ) => Promise<HeldSendStatus>;
}): Promise<ComposeHeldReceipt | null> => {
  await input.cancel();
  const { capture } = input;
  if (capture === null || !input.isCurrent()) {
    return null;
  }
  const status = await input.readStatus({
    mailboxId: capture.mailboxId,
    sendOperationId: capture.sendOperationId,
  });
  if (
    !input.isCurrent() ||
    status === null ||
    status.mailboxId !== capture.mailboxId ||
    status.sendOperationId !== capture.sendOperationId
  ) {
    return null;
  }
  return {
    canUndo: status.canUndo,
    draftId: capture.draftId,
    draftRevision: capture.draftRevision,
    mailboxId: capture.mailboxId,
    restoredDraftId: status.draftId,
    sendOperationId: capture.sendOperationId,
    status: status.status,
    undoUntil: status.undoUntil,
  };
};
