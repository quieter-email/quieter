import { createEmptyComposeDraft } from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { toastError } from "@quieter/app/lib/error-toast";
import { refreshCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/index";
import { orpc, rpc } from "@quieter/app/lib/orpc";
import { toast } from "@quieter/ui/toast";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Reopens a composer for a draft restored by Undo. The draft carries its saved
 * draftId, so the composer loads its files like any saved draft. Returns false
 * when the host cannot show it, for example because another draft is open.
 */
export type RestoreUndoneDraft = (
  draft: ComposeDraftState,
  mailboxId: string
) => boolean;

export const showHeldSendToast = ({
  canUndo,
  description,
  mailboxId,
  onRestore,
  queryClient,
  remainingMs,
  sendOperationId,
}: {
  canUndo: boolean;
  description?: string;
  mailboxId: string;
  onRestore?: RestoreUndoneDraft;
  queryClient: QueryClient;
  remainingMs: number;
  sendOperationId: string;
}) => {
  if (!canUndo || remainingMs <= 0) {
    toast.success("Message sent.", { description });
    return;
  }
  const id = `held-send:${sendOperationId}`;
  const refresh = async (folder: "drafts" | "sent") => {
    await Promise.all([
      refreshCachedMailboxQueries(queryClient, mailboxId, folder),
      queryClient.invalidateQueries({
        queryKey: orpc.scheduledSends.list.queryOptions({
          input: { mailboxId },
        }).queryKey,
      }),
    ]).catch((error: unknown) => {
      toastError(error, { boundary: "held-send-undo-refresh" });
    });
  };
  // The toast timer pauses while hovered, but the server sends at the
  // deadline, so Undo must disappear on the server's clock.
  const expiry = setTimeout(() => {
    toast.dismiss(id);
  }, remainingMs);
  let undoing = false;
  const undo = async () => {
    if (undoing) {
      return;
    }
    undoing = true;
    clearTimeout(expiry);
    toast.dismiss(id);
    const pendingId = toast.loading("Undoing send…", { id: `${id}:undo` });
    let undone: Awaited<ReturnType<typeof rpc.mail.undoSend>>;
    try {
      undone = await rpc.mail.undoSend({ mailboxId, sendOperationId });
    } catch (error) {
      toast.dismiss(pendingId);
      toastError(error, {
        boundary: "held-send-undo",
        fallback: "Could not undo this send. Check Sent before sending again.",
      });
      await refresh("sent");
      return;
    }
    try {
      if (undone.draftId === null) {
        toast.dismiss(pendingId);
        toast.success(
          undone.status === "abandoned"
            ? "Send undone. Check Drafts for your message."
            : "Send undone. Open Sent to restore your message."
        );
        return;
      }
      const canonical = await rpc.mail.getDraft({
        draftId: undone.draftId,
        mailboxId,
      });
      toast.dismiss(pendingId);
      const restored: ComposeDraftState = {
        ...createEmptyComposeDraft(),
        ...canonical,
        draftAnchor: canonical.draftAnchor ?? null,
        messageId: canonical.messageId ?? undefined,
        saveStatus: "saved",
      };
      if (onRestore?.(restored, mailboxId) !== true) {
        toast.success("Send undone. Your message is back in Drafts.");
      }
    } catch (error) {
      toast.dismiss(pendingId);
      toastError(error, {
        boundary: "held-send-restore",
        fallback: "Send undone. Open Drafts to keep editing your message.",
      });
    } finally {
      await refresh("drafts");
    }
  };
  toast.success("Message sent.", {
    action: {
      label: "Undo",
      onClick: () => {
        void undo();
      },
    },
    description,
    duration: remainingMs,
    id,
  });
};
