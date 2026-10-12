"use client";

import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

export const SaveSnippetDialog = ({
  initialText,
  mailboxId,
  onClose,
}: {
  initialText: string;
  mailboxId: string;
  onClose: () => void;
}) => {
  const id = useId();
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState(initialText);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    ...orpc.mailSnippets.create.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "save-snippet",
        fallback: "Could not save the snippet. Please try again.",
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.mailSnippets.list.queryOptions({ input: { mailboxId } })
          .queryKey,
      });
      toast.success("Snippet saved.");
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() && bodyText.trim() && !mutation.isPending) {
              mutation.mutate({ bodyText, mailboxId, name });
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Save a snippet</DialogTitle>
            <DialogDescription>
              Available to everyone with access to this mailbox. Type / and its
              name to insert it.
            </DialogDescription>
          </DialogHeader>
          <DialogBody spacing="4">
            <div className="space-y-2">
              <label
                className="text-caption font-medium"
                htmlFor={`${id}-name`}
              >
                Name
              </label>
              <Input
                id={`${id}-name`}
                maxLength={120}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                placeholder="e.g. Thank you"
                required
                value={name}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-caption font-medium"
                htmlFor={`${id}-text`}
              >
                Text
              </label>
              <Textarea
                id={`${id}-text`}
                maxLength={100_000}
                onChange={(event) => {
                  setBodyText(event.currentTarget.value);
                }}
                required
                rows={6}
                value={bodyText}
              />
            </div>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button
              disabled={mutation.isPending || !name.trim() || !bodyText.trim()}
              type="submit"
            >
              {mutation.isPending ? "Saving…" : "Save snippet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
