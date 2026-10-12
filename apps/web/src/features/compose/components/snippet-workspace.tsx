"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Delete02Icon,
  Loading03Icon,
  Search01Icon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  WorkspaceSection,
  workspaceSectionVariants,
} from "#/components/workspace-section";
import { toastError } from "#/lib/error-toast";
import { orpc } from "#/lib/orpc";

type MailSnippetItem = {
  bodyText: string;
  id: string;
  name: string;
};

export const SnippetWorkspace = ({
  mailboxId,
  onOpenSidebar,
}: {
  mailboxId: string;
  onOpenSidebar: () => void;
}) => {
  const queryClient = useQueryClient();
  const queryOptions = orpc.mailSnippets.list.queryOptions({
    input: { mailboxId },
  });
  const {
    data: snippetsData,
    isError: isSnippetsError,
    isPending: isSnippetsPending,
  } = useQuery(queryOptions);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteSnippet, setDeleteSnippet] = useState<MailSnippetItem | null>(
    null
  );
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const refreshSnippets = async () => {
    await queryClient.invalidateQueries({ queryKey: queryOptions.queryKey });
  };
  const createMutation = useMutation({
    ...orpc.mailSnippets.create.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "mail-snippets",
        fallback: "Could not save the snippet.",
      });
    },
    onSuccess: async (snippet) => {
      await refreshSnippets();
      setEditingId(snippet.id);
      toast.success("Snippet saved.");
    },
  });
  const updateMutation = useMutation({
    ...orpc.mailSnippets.update.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "mail-snippets",
        fallback: "Could not update the snippet.",
      });
    },
    onSuccess: async () => {
      await refreshSnippets();
      toast.success("Snippet updated.");
    },
  });
  const deleteMutation = useMutation({
    ...orpc.mailSnippets.delete.mutationOptions(),
    onError: (error) => {
      toastError(error, {
        boundary: "mail-snippets",
        fallback: "Could not delete the snippet.",
      });
    },
    onSuccess: async () => {
      await refreshSnippets();
      setDeleteSnippet(null);
      setEditingId(null);
      setMobileEditorOpen(false);
      setName("");
      setBodyText("");
      toast.success("Snippet deleted.");
    },
  });
  const snippets = snippetsData?.snippets ?? [];
  const normalizedSearch = search.trim().toLowerCase();
  const filteredSnippets = normalizedSearch
    ? snippets.filter((snippet) =>
        snippet.name.toLowerCase().includes(normalizedSearch)
      )
    : snippets;
  const currentSnippet =
    snippets.find((snippet) => snippet.id === editingId) ?? null;
  const isSaving = createMutation.isPending || updateMutation.isPending;
  let snippetQueryState: ReactNode = null;
  if (isSnippetsPending) {
    snippetQueryState = (
      <div className="flex items-center justify-center gap-2 px-3 py-10 text-caption text-muted-fg">
        <HugeiconsIcon className="size-3.5 animate-spin" icon={Loading03Icon} />
        Loading snippets
      </div>
    );
  } else if (isSnippetsError) {
    snippetQueryState = (
      <p className="px-3 py-10 text-center text-caption/5 text-destructive">
        Could not load snippets.
      </p>
    );
  } else if (filteredSnippets.length === 0) {
    snippetQueryState = (
      <div className="px-6 py-12 text-center">
        <p className="text-body font-medium text-fg">
          {snippets.length === 0 ? "No snippets yet" : "No matches"}
        </p>
        <p className="mt-1 text-caption/5 text-muted-fg">
          {snippets.length === 0
            ? "Save text you use often in this mailbox."
            : "Try a different search."}
        </p>
      </div>
    );
  }

  return (
    <>
      <WorkspaceSection
        className={cn("lg:flex", {
          flex: !mobileEditorOpen,
          hidden: mobileEditorOpen,
        })}
        layout="cell"
      >
        <header className="@container p-4 sm:p-5">
          <div className="flex items-center gap-2">
            <IconButtonTooltip label="Open sidebar">
              <Button
                aria-label="Open sidebar"
                className="lg:hidden"
                onClick={onOpenSidebar}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={SidebarLeftIcon} />
              </Button>
            </IconButtonTooltip>
            <h1 className="min-w-0 flex-1 text-body font-semibold tracking-tight text-fg">
              Snippets
            </h1>
            <Button
              onClick={() => {
                setEditingId(null);
                setName("");
                setBodyText("");
                setMobileEditorOpen(true);
              }}
              size="sm"
              type="button"
            >
              <HugeiconsIcon icon={Add01Icon} />
              New
            </Button>
          </div>
          <label
            className="relative mt-4 block"
            htmlFor="snippet-workspace-search"
          >
            <span className="sr-only" id="snippet-workspace-search-label">
              Search snippets
            </span>
            <HugeiconsIcon
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-fg"
              icon={Search01Icon}
            />
            <Input
              aria-labelledby="snippet-workspace-search-label"
              // oxlint-disable-next-line shadcn/no-restyle -- Search input leaves room for its leading icon.
              className="pl-9"
              id="snippet-workspace-search"
              onChange={(event) => {
                setSearch(event.currentTarget.value);
              }}
              placeholder="Search snippets"
              value={search}
            />
          </label>
        </header>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-4 sm:px-4 sm:pb-5">
          {filteredSnippets.map((snippet) => (
            <button
              aria-label={`Edit snippet ${snippet.name}`}
              aria-current={editingId === snippet.id ? "true" : undefined}
              className={cn(
                "group flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                {
                  "bg-muted text-fg": editingId === snippet.id,
                  "text-muted-fg hover:bg-muted/55 hover:text-fg":
                    editingId !== snippet.id,
                }
              )}
              key={snippet.id}
              onClick={() => {
                setEditingId(snippet.id);
                setName(snippet.name);
                setBodyText(snippet.bodyText);
                setMobileEditorOpen(true);
              }}
              type="button"
            >
              <span
                className={cn(
                  "mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-fg/30 transition-colors",
                  {
                    "bg-primary": editingId === snippet.id,
                    "group-hover:bg-muted-fg/60": editingId !== snippet.id,
                  }
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">
                  {snippet.name}
                </span>
                <span className="mt-1 block truncate text-micro text-muted-fg">
                  {snippet.bodyText}
                </span>
              </span>
            </button>
          ))}
          {snippetQueryState}
        </div>
      </WorkspaceSection>

      <form
        className={cn(workspaceSectionVariants({ layout: "cell" }), "lg:flex", {
          flex: mobileEditorOpen,
          hidden: !mobileEditorOpen,
        })}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) {
            toast.error("Give this snippet a name.");
            return;
          }
          if (!bodyText.trim()) {
            toast.error("Add snippet text before saving.");
            return;
          }
          const input = { bodyText, mailboxId, name: name.trim() };
          if (editingId) {
            updateMutation.mutate({ ...input, id: editingId });
          } else {
            createMutation.mutate(input);
          }
        }}
      >
        <div className="flex h-full min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 sm:gap-5 sm:p-5">
          <div className="-mx-4 -mt-4 flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 sm:-mx-5 sm:-mt-5 sm:px-5 lg:hidden">
            <IconButtonTooltip label="Back to snippets">
              <Button
                aria-label="Back to snippets"
                onClick={() => {
                  setMobileEditorOpen(false);
                }}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} />
              </Button>
            </IconButtonTooltip>
            <p className="text-body font-medium tracking-tight text-fg">
              {editingId ? "Edit snippet" : "New snippet"}
            </p>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <label
              className="flex flex-col gap-2 text-caption font-medium text-fg"
              htmlFor="snippet-workspace-name"
            >
              Name
              <Input
                id="snippet-workspace-name"
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                placeholder="Snippet name"
                value={name}
              />
            </label>
            <label
              className="flex min-h-0 flex-1 flex-col gap-2 text-caption font-medium text-fg"
              htmlFor="snippet-workspace-text"
            >
              Text
              <Textarea
                id="snippet-workspace-text"
                // oxlint-disable-next-line shadcn/no-restyle -- The text field fills the workspace panel.
                className="min-h-48 flex-1 resize-none"
                onChange={(event) => {
                  setBodyText(event.currentTarget.value);
                }}
                placeholder="Write text to reuse in a message"
                value={bodyText}
              />
            </label>
            <div className="flex justify-end gap-2">
              {currentSnippet ? (
                <Button
                  onClick={() => {
                    setDeleteSnippet(currentSnippet);
                  }}
                  type="button"
                  variant="ghost"
                >
                  <HugeiconsIcon icon={Delete02Icon} />
                  Delete
                </Button>
              ) : null}
              <Button disabled={isSaving} type="submit">
                {isSaving ? (
                  <HugeiconsIcon
                    className="animate-spin"
                    icon={Loading03Icon}
                  />
                ) : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </form>

      <AlertDialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteSnippet(null);
          }
        }}
        open={!!deleteSnippet}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteSnippet?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the snippet from this mailbox.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody
            // oxlint-disable-next-line shadcn/no-restyle -- Danger copy keeps body text.
            className="text-body text-muted-fg"
          >
            Messages that already used this snippet will not change.
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton>Cancel</AlertDialogCloseButton>
            <AlertDialogCloseButton
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteSnippet) {
                  deleteMutation.mutate({ id: deleteSnippet.id, mailboxId });
                }
              }}
              variant="destructive"
            >
              Delete
            </AlertDialogCloseButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};
