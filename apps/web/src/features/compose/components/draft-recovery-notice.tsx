import { Button } from "@quieter/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { draftRecoveryJournal } from "#/lib/draft-recovery-journal";
import { toastError } from "#/lib/error-toast";

import type { ComposeDraftState } from "../domain/draft";
import { restoreComposeDraft } from "../domain/draft-recovery";

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
    queryFn: () => draftRecoveryJournal.list(mailboxId),
    queryKey,
    staleTime: 0,
  });
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
    <output className="absolute inset-x-3 bottom-3 z-20 flex items-center gap-3 rounded-lg border border-border bg-bg p-3 shadow-lg">
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
        variant="ghost"
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
