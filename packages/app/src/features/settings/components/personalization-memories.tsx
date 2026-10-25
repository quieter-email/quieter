"use client";

import { Add01Icon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SettingsCard,
  SettingsErrorState,
  SettingsLoadingState,
  settingsSurfaceVariants,
} from "@quieter/app/features/settings/components/settings-layout";
import { toastError } from "@quieter/app/lib/error-toast";
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
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { MemoryEditor } from "./personalization-memory-editor";
import type { PersonalMemory } from "./personalization-memory-editor";

export const PersonalizationMemories = ({
  actions,
}: {
  actions: ReactNode;
}) => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<PersonalMemory | "new" | null>(null);
  const [deleting, setDeleting] = useState<PersonalMemory | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(search.trim());
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [search]);
  const memories = useInfiniteQuery(
    orpc.ai.memories.infiniteOptions({
      getNextPageParam: (page) => page.nextCursor ?? undefined,
      initialPageParam: undefined,
      input: (cursor: string | undefined) => ({ cursor, limit: 20, query }),
    })
  );
  const items = memories.data?.pages.flatMap((page) => page.items) ?? [];
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
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        toast.success("Memory deleted.");
      },
    })
  );
  const retryMemories = async () => {
    const result = await memories.refetch();
    if (result.error) {
      toastError(result.error, { boundary: "ai-settings" });
    }
  };
  const loadMore = async () => {
    const result = await memories.fetchNextPage();
    if (result.error) {
      toastError(result.error, { boundary: "ai-settings" });
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
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
        <IconButtonTooltip label="Add memory">
          <Button
            aria-label="Add memory"
            onClick={() => {
              setEditor("new");
            }}
            size="icon"
          >
            <HugeiconsIcon aria-hidden icon={Add01Icon} />
          </Button>
        </IconButtonTooltip>
        {actions}
      </div>
      <div aria-busy={memories.isFetching}>
        {memories.isPending ? (
          <SettingsLoadingState label="Loading memories" />
        ) : null}
        {memories.isError ? (
          <SettingsErrorState
            message="Could not load memories."
            onRetry={() => {
              void retryMemories();
            }}
          />
        ) : null}
        {items.length > 0 ? (
          <SettingsCard>
            <ul className={settingsSurfaceVariants({ variant: "divide" })}>
              {items.map((memory) => (
                <li
                  className={cn(
                    settingsSurfaceVariants({ variant: "padding" }),
                    "flex items-start gap-3"
                  )}
                  key={memory.id}
                >
                  <p className="min-w-0 flex-1 text-body-sm break-words whitespace-pre-wrap text-fg">
                    {memory.content}
                  </p>
                  <DropdownMenu>
                    <IconButtonTooltip label="Memory actions">
                      <DropdownMenuTrigger
                        render={
                          <Button
                            aria-label="Memory actions"
                            size="icon-xs"
                            variant="ghost"
                          />
                        }
                      >
                        <HugeiconsIcon aria-hidden icon={MoreHorizontalIcon} />
                      </DropdownMenuTrigger>
                    </IconButtonTooltip>
                    <DropdownMenuContent align="end" size="compact">
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditor(memory);
                        }}
                      >
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => {
                          setDeleting(memory);
                        }}
                        tone="destructive"
                      >
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          </SettingsCard>
        ) : null}
        {memories.isSuccess && items.length === 0 ? (
          <p className="text-body-sm text-muted-fg">
            {query ? "No matching memories." : "No memories yet."}
          </p>
        ) : null}
      </div>
      {memories.hasNextPage ? (
        <ActionFooter>
          <Button
            onClick={() => {
              void loadMore();
            }}
            pending={memories.isFetchingNextPage}
            pendingLabel="Loading"
            size="sm"
          >
            Load more
          </Button>
        </ActionFooter>
      ) : null}
      {editor === null ? null : (
        <MemoryEditor
          key={editor === "new" ? "new" : editor.id}
          memory={editor === "new" ? undefined : editor}
          onClose={() => {
            setEditor(null);
          }}
          onSaved={() => {
            setEditor(null);
          }}
        />
      )}
      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !deletion.isPending) {
            setDeleting(null);
          }
        }}
        open={deleting !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              disabled={deletion.isPending}
              onClick={() => {
                setDeleting(null);
              }}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={deletion.isPending || deleting === null}
              onClick={() => {
                if (deleting) {
                  deletion.mutate({ memoryId: deleting.id });
                }
              }}
              pending={deletion.isPending}
              pendingLabel="Deleting"
              variant="destructive"
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
