"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

export type PersonalMemory = RouterOutputs["ai"]["memories"]["items"][number];

export const MemoryEditor = ({
  memory,
  onClose,
  onSaved,
}: {
  memory?: PersonalMemory;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const formId = useId();
  const queryClient = useQueryClient();
  const [content, setContent] = useState(memory?.content ?? "");
  const save = useMutation(
    orpc.ai.saveMemory.mutationOptions({
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not save this memory. Please try again.",
        });
      },
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        toast.success(memory ? "Memory updated." : "Memory added.");
        onSaved();
      },
    })
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !save.isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{memory ? "Edit memory" : "Add memory"}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                category: memory?.category ?? "preferences",
                content,
                correspondents: memory?.correspondents ?? [],
                memoryId: memory?.id,
                version: memory?.version,
              });
            }}
          >
            <Textarea
              aria-label="Memory"
              disabled={save.isPending}
              maxLength={2000}
              onChange={(event) => {
                setContent(event.target.value);
              }}
              placeholder="What should quieter remember?"
              required
              rows={4}
              value={content}
            />
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={save.isPending}>
            Cancel
          </DialogCloseButton>
          <Button
            disabled={content.trim().length === 0 || save.isPending}
            form={formId}
            pending={save.isPending}
            pendingLabel="Saving"
            type="submit"
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
