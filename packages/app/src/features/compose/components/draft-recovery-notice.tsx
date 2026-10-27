import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { restoreComposeDraft } from "@quieter/app/features/compose/domain/draft-recovery";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { entranceMotionVariants } from "@quieter/ui/motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export const DraftRecoveryNotice = ({
  mailboxId,
  onResume,
}: {
  mailboxId: string;
  onResume: (draft: ComposeDraftState) => void;
}) => {
  const queryClient = useQueryClient();
  const queryKey = ["local-draft-recovery", mailboxId];
  const { data = [] } = useQuery({
    queryFn: () => draftRecoveryJournal.listRecoverable(mailboxId),
    queryKey,
    staleTime: 0,
  });
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({
        queryKey: ["local-draft-recovery", mailboxId],
      });
    };
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
    };
  }, [mailboxId, queryClient]);
  const discard = useMutation({
    mutationFn: async () => {
      const [record] = data;
      if (record !== undefined) {
        draftRecoveryJournal.remove(record);
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
          try {
            onResume(
              restoreComposeDraft(
                record.payload,
                record.editorId,
                record.updatedAt
              )
            );
          } catch (error) {
            toastError(error, { boundary: "compose-recovery-open" });
          }
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
