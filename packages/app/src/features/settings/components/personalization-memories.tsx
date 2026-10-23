"use client";

import {
  SettingsCard,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { orpc } from "@quieter/app/lib/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
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
import { Input } from "@quieter/ui/input";
import { Pill } from "@quieter/ui/pill";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  MemoryEditor,
  memoryCategoryItems,
  memoryCategories,
} from "./personalization-memory-editor";
import type {
  MemoryTarget,
  PersonalMemory,
} from "./personalization-memory-editor";

type PagePosition = { cursor?: string; previous: (string | undefined)[] };
type MemoryEditorState =
  | { kind: "add" }
  | { kind: "edit"; memory: PersonalMemory };

const memorySourceLabels = {
  explicit: "Added by you",
  feedback: "Learned from feedback",
  inferred: "Learned from mail and chat",
  migration: "Saved context",
} satisfies Record<PersonalMemory["source"], string>;

export const PersonalizationMemories = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mailboxId, setMailboxId] = useState<string | null>(null);
  const mailboxes = useQuery(mailboxesQueryOptions(open));
  const availableMailboxes =
    mailboxes.data?.groups
      .flatMap((group) => group.mailboxes)
      .filter((item) => item.provider !== "api") ?? [];
  const target: MemoryTarget =
    mailboxId === null ? { scope: "user" } : { mailboxId, scope: "mailbox" };
  const canEdit =
    mailboxId === null ||
    availableMailboxes.find((item) => item.id === mailboxId)?.capabilities
      .canManageKnowledge === true;
  const scopeItems = [
    { label: "Personal memories", value: "user" },
    ...availableMailboxes.map((item) => ({
      label: `${item.emailAddress}, mailbox knowledge`,
      value: `mailbox:${item.id}`,
    })),
  ];
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<PersonalMemory["category"] | "all">(
    "all"
  );
  const [page, setPage] = useState<PagePosition>({ previous: [] });
  const [editor, setEditor] = useState<MemoryEditorState | null>(null);
  const [deleting, setDeleting] = useState<PersonalMemory | null>(null);
  const memories = useQuery(
    orpc.ai.memories.queryOptions({
      enabled: open,
      input: {
        ...target,
        category: category === "all" ? undefined : category,
        cursor: page.cursor,
        limit: 20,
        query,
      },
    })
  );
  const deletion = useMutation(
    orpc.ai.forgetMemory.mutationOptions({
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not delete this memory. Please try again.",
        });
      },
      async onSuccess() {
        setDeleting(null);
        setPage({ previous: [] });
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        toast.success("Memory deleted.");
      },
    })
  );
  const categoryItems = [
    { label: "All categories", value: "all" },
    ...memoryCategoryItems,
  ];
  const retryMemories = async () => {
    const result = await memories.refetch();
    if (result.error) {
      toastError(result.error, { boundary: "ai-settings" });
    }
  };

  return (
    <>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogTrigger render={<Button size="sm" variant="secondary" />}>
          Manage memories
        </DialogTrigger>
        <DialogContent className="flex max-h-[85dvh] flex-col">
          <DialogHeader>
            <DialogTitle>What Quieter remembers</DialogTitle>
            <DialogDescription>
              Search, add, correct, or permanently delete memories. Personal
              memories follow you across inboxes. Mailbox knowledge stays with
              that inbox.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="4">
            {availableMailboxes.length > 0 ? (
              <Select
                items={scopeItems}
                value={mailboxId === null ? "user" : `mailbox:${mailboxId}`}
                onValueChange={(value) => {
                  if (value === "user") {
                    setMailboxId(null);
                  } else {
                    const selected = availableMailboxes.find(
                      (item) => `mailbox:${item.id}` === value
                    );
                    if (!selected) {
                      return;
                    }
                    setMailboxId(selected.id);
                  }
                  setPage({ previous: [] });
                }}
              >
                <SelectTrigger aria-label="Memory scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {scopeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            ) : null}
            <form
              className="flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setQuery(search.trim());
                setPage({ previous: [] });
              }}
            >
              <Input
                aria-label="Search memories"
                className="min-w-0 flex-1"
                maxLength={500}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
                placeholder="Search memories"
                type="search"
                value={search}
              />
              <Button size="sm" type="submit" variant="secondary">
                Search
              </Button>
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                items={categoryItems}
                onValueChange={(value) => {
                  const selected = memoryCategoryItems.find(
                    (item) => item.value === value
                  );
                  if (value === "all" || selected) {
                    setCategory(selected?.value ?? "all");
                    setPage({ previous: [] });
                  }
                }}
                value={category}
              >
                <SelectTrigger
                  aria-label="Memory category"
                  className="min-w-0 flex-1"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {categoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
              <Button
                disabled={!canEdit}
                onClick={() => {
                  setEditor({ kind: "add" });
                }}
                size="sm"
                type="button"
              >
                Add memory
              </Button>
            </div>
            {memories.isPending ? (
              <output className="text-body text-muted-fg">
                Loading memories...
              </output>
            ) : null}
            {memories.isError ? (
              <div className="space-y-3" role="alert">
                <p className="text-body text-muted-fg">
                  Could not load memories. Please try again.
                </p>
                <Button
                  onClick={() => {
                    void retryMemories();
                  }}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {memories.isSuccess ? (
              <>
                <p aria-live="polite" className="text-caption text-muted-fg">
                  {memories.data.total}{" "}
                  {memories.data.total === 1 ? "memory" : "memories"}
                  {query ? ` matching "${query}"` : ""}
                </p>
                {memories.data.items.length === 0 ? (
                  <p className="text-body text-muted-fg">
                    {query || category !== "all"
                      ? "No matching memories. Try another search or category."
                      : "No memories yet. Add something you want Quieter to know, or let it learn as you use mail and chat."}
                  </p>
                ) : null}
                <div className="space-y-3">
                  {memories.data.items.map((memory) => (
                    <SettingsCard key={memory.id}>
                      <div
                        className={settingsSurfaceVariants({ variant: "body" })}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Pill size="xs" tone="neutral">
                            {memoryCategories[memory.category]}
                          </Pill>
                          <span className="text-caption text-muted-fg">
                            {memorySourceLabels[memory.source]}
                          </span>
                        </div>
                        <p className="text-body break-words whitespace-pre-wrap text-fg">
                          {memory.content}
                        </p>
                        {memory.correspondents.length > 0 ? (
                          <p className="text-caption break-words text-muted-fg">
                            With {memory.correspondents.join(", ")}
                          </p>
                        ) : null}
                        <p className="text-caption text-muted-fg">
                          Updated{" "}
                          <time dateTime={memory.updatedAt}>
                            {new Date(memory.updatedAt).toLocaleDateString(
                              undefined,
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }
                            )}
                          </time>
                        </p>
                        <ActionFooter>
                          <Button
                            disabled={!canEdit}
                            onClick={() => {
                              setEditor({ kind: "edit", memory });
                            }}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Edit
                          </Button>
                          <Button
                            disabled={!canEdit}
                            onClick={() => {
                              setDeleting(memory);
                            }}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            Delete
                          </Button>
                        </ActionFooter>
                      </div>
                    </SettingsCard>
                  ))}
                </div>
                {page.previous.length > 0 || memories.data.nextCursor ? (
                  <ActionFooter>
                    <Button
                      disabled={page.previous.length === 0}
                      onClick={() => {
                        setPage((current) => ({
                          cursor: current.previous.at(-1),
                          previous: current.previous.slice(0, -1),
                        }));
                      }}
                      size="sm"
                      type="button"
                      variant="secondary"
                    >
                      Previous
                    </Button>
                    <Button
                      disabled={!memories.data.nextCursor}
                      onClick={() => {
                        const { nextCursor } = memories.data;
                        if (nextCursor) {
                          setPage((current) => ({
                            cursor: nextCursor,
                            previous: [...current.previous, current.cursor],
                          }));
                        }
                      }}
                      size="sm"
                      type="button"
                    >
                      Next
                    </Button>
                  </ActionFooter>
                ) : null}
              </>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton variant="default">Done</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editor ? (
        <MemoryEditor
          key={editor.kind === "edit" ? editor.memory.id : "new"}
          memory={editor.kind === "edit" ? editor.memory : undefined}
          target={target}
          onClose={() => {
            setEditor(null);
          }}
          onSaved={() => {
            setPage({ previous: [] });
            setEditor(null);
          }}
        />
      ) : null}
      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deletion.isPending) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the memory. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={deletion.isPending}
              onClick={() => {
                setDeleting(null);
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={deletion.isPending || deleting === null}
              onClick={() => {
                if (deleting) {
                  deletion.mutate({ ...target, memoryId: deleting.id });
                }
              }}
              pending={deletion.isPending}
              pendingLabel="Deleting"
              type="button"
              variant="destructive"
            >
              Delete memory
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
