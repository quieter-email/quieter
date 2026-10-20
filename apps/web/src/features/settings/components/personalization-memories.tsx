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
  const exportedAt = memories.data ? Date.parse(memories.data.exportedAt) : 0;
  const profile = [
    ...new Set(
      (memories.data?.memories ?? [])
        .filter(
          (memory) =>
            memory.status === "active" &&
            (memory.expiresAt === null ||
              Date.parse(memory.expiresAt) > exportedAt)
        )
        .map((memory) => memory.summary.replaceAll(/\s+/gu, " ").trim())
        .filter(Boolean)
    ),
  ]
    .map((summary) => (/[.!?]$/u.test(summary) ? summary : `${summary}.`))
    .join(" ");

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
            The personal context Quieter uses to help you. Ask in chat to
            correct or forget something.
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
          {memories.isSuccess && profile.length === 0 ? (
            <p className="text-body text-muted-fg">
              No personal memories to show yet.
            </p>
          ) : null}
          {memories.isSuccess && profile.length > 0 ? (
            <p className="text-body leading-relaxed text-fg">{profile}</p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton>Close</DialogCloseButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
