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
  DialogTrigger,
} from "@quieter/ui/dialog";
import { useMutation } from "@tanstack/react-query";

import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

export const PersonalizationMemories = () => {
  const memories = useMutation(
    orpc.ai.exportMemory.mutationOptions({
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not load memories. Please try again.",
        });
      },
    })
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          memories.mutate({ scope: "user" });
        } else {
          memories.reset();
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        View memories
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] flex-col">
        <DialogHeader>
          <DialogTitle>What Quieter remembers</DialogTitle>
          <DialogDescription>
            Recent saved personal context, including archived memories. Shared
            mailbox knowledge is separate. Ask Quieter in chat to correct or
            forget something.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
          {memories.isPending ? (
            <output className="text-body text-muted-fg">
              Loading memories...
            </output>
          ) : null}
          {memories.isError ? (
            <div className="space-y-3">
              <p className="text-body text-muted-fg" role="alert">
                Could not load memories. Please try again.
              </p>
              <Button
                onClick={() => {
                  memories.mutate({ scope: "user" });
                }}
                size="sm"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : null}
          {memories.isSuccess && memories.data.memories.length === 0 ? (
            <p className="text-body text-muted-fg">
              No personal memories have been saved yet.
            </p>
          ) : null}
          {memories.isSuccess ? (
            <ul className="space-y-4">
              {memories.data.memories.map((memory) => (
                <li
                  className="space-y-2 rounded-lg border border-border p-3"
                  key={`${memory.kind}:${memory.updatedAt}:${memory.summary}`}
                >
                  <p className="text-body font-medium wrap-anywhere">
                    {memory.summary}
                  </p>
                  {memory.content === memory.summary ? null : (
                    <p className="text-body-sm wrap-anywhere whitespace-pre-wrap text-muted-fg">
                      {memory.content}
                    </p>
                  )}
                  <p className="text-caption text-muted-fg">
                    {memory.status === "archived" ? "Archived" : "Saved"}
                    {memory.expiresAt !== null &&
                    new Date(memory.expiresAt).getTime() <=
                      new Date(memories.data.exportedAt).getTime()
                      ? ", expired"
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter fullWidth>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
