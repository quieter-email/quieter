import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { restoreComposeDraft } from "@quieter/app/features/compose/domain/draft-recovery";
import { authClient } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const DraftRecoveryNotice = ({
  mailboxId,
  userId,
  onResume,
}: {
  mailboxId: string;
  userId: string;
  onResume: (draft: ComposeDraftState) => void;
}) => {
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  const sessionId = authClient.useSession().data?.session.id;
  const recovery = draftRecoveryJournal.session(userId, sessionId);
  const queryKey = ["local-draft-recovery", userId, mailboxId];
  const { data = [] } = useQuery({
    queryFn: async () => await recovery.listRecoverable({ mailboxId, userId }),
    queryKey,
    staleTime: 0,
  });
  useEffect(() => {
    mounted.current = true;
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: ["local-draft-recovery", userId, mailboxId],
      });
    };
    window.addEventListener("storage", refresh);
    const unsubscribe = draftRecoveryJournal.subscribe(refresh);
    return () => {
      mounted.current = false;
      window.removeEventListener("storage", refresh);
      unsubscribe();
    };
  }, [mailboxId, queryClient, userId]);
  const discard = useMutation({
    mutationFn: async () => {
      const [record] = data;
      if (record !== undefined) {
        await recovery.remove(record);
      }
      await queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      toastError(error, { boundary: "compose-recovery-discard" });
    },
  });
  const [record] = data;
  if (record === undefined) {
    return null;
  }
  return (
    <output
      className={cn(
        "m-3 flex shrink-0 items-center gap-3 rounded-lg border border-border bg-bg p-3",
        entranceMotionVariants()
      )}
    >
      <span className="min-w-0 flex-1 text-body-sm">
        An unfinished draft is saved on this device.
      </span>
      <Button
        size="sm"
        onClick={() => {
          void (async () => {
            try {
              const records = await recovery.listRecoverable({
                mailboxId,
                userId,
              });
              const currentRecord = records.find(
                (current) =>
                  current.editorId === record.editorId &&
                  current.localId === record.localId
              );
              if (currentRecord === undefined || !mounted.current) {
                void queryClient.invalidateQueries({ queryKey });
                return;
              }
              onResume(
                restoreComposeDraft(
                  currentRecord.payload,
                  currentRecord.editorId,
                  currentRecord.updatedAt,
                  undefined,
                  currentRecord.revision
                )
              );
            } catch (error) {
              toastError(error, { boundary: "compose-recovery-open" });
            }
          })();
        }}
      >
        Resume
      </Button>
      <Button
        size="sm"
        variant="destructive"
        disabled={discard.isPending}
        onClick={() => {
          discard.mutate();
        }}
      >
        Discard copy
      </Button>
    </output>
  );
};
