"use client";

import { Delete01Icon, Edit01Icon, MoreVerticalIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EyeIcon,
  EyeOffIcon,
  IconButtonTooltip,
  Input,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { m } from "motion/react";
import { useMemo, useState } from "react";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import { serializeStructuredSearchState } from "~/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "~/features/message-search/state/message-list-search-state";
import { getLabelsQueryKey, labelsQueryOptions } from "~/lib/gmail/labels-query";
import { orpc } from "~/lib/orpc";

type SidebarLabelNavProps = {
  animateEntrance: boolean;
  mailboxId: string | null;
  onSearch: (query: string) => void;
  searchQuery: string;
};

type EditingLabel =
  | { mode: "create"; name: string }
  | { label: GmailLabelListItem; mode: "rename"; name: string }
  | null;

type HiddenLabelState = {
  mailboxId: string | null;
  value: Set<string>;
};

const MAX_VISIBLE_SIDEBAR_LABELS = 10;
const SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY = "quieter:sidebar-label-visibility";

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(20px)" } : false;

const updateLabelFilter = (searchQuery: string, labelName: string, enabled: boolean) => {
  const state = parseStructuredSearchQuery(searchQuery);
  const labelKey = normalizeLabelSelectionKey(labelName);
  const filters = state.filters.filter(
    (filter) => filter.type !== "label" || normalizeLabelSelectionKey(filter.value) !== labelKey,
  );

  return serializeStructuredSearchState({
    ...state,
    filters: enabled ? [...filters, { type: "label", value: labelName }] : filters,
  });
};

const readHiddenLabelIds = (mailboxId: string | null) => {
  if (!mailboxId || typeof window === "undefined") return new Set<string>();

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY) ?? "{}",
    ) as Record<string, string[]>;
    return new Set(parsed[mailboxId] ?? []);
  } catch {
    return new Set<string>();
  }
};

const writeHiddenLabelIds = (mailboxId: string, hiddenLabelIds: Set<string>) => {
  let parsed: Record<string, string[]> = {};
  try {
    const raw = window.localStorage.getItem(SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY);
    parsed = raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
  } catch {}

  parsed[mailboxId] = Array.from(hiddenLabelIds);
  window.localStorage.setItem(SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY, JSON.stringify(parsed));
};

export const SidebarLabelNav = ({
  animateEntrance,
  mailboxId,
  onSearch,
  searchQuery,
}: SidebarLabelNavProps) => {
  const [shouldAnimateEntrance] = useState(animateEntrance);
  const queryClient = useQueryClient();
  const [editingLabel, setEditingLabel] = useState<EditingLabel>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [hiddenLabelState, setHiddenLabelState] = useState<HiddenLabelState>(() => ({
    mailboxId,
    value: readHiddenLabelIds(mailboxId),
  }));
  const labelsQuery = useQuery(labelsQueryOptions(mailboxId ?? "", !!mailboxId));
  const userLabels = getUserLabels(labelsQuery.data ?? []);
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = new Set(hiddenLabelIds);
  for (const label of userLabels
    .filter((userLabel) => !hiddenLabelIds.has(userLabel.id))
    .slice(MAX_VISIBLE_SIDEBAR_LABELS)) {
    effectiveHiddenLabelIds.add(label.id);
  }
  const visibleUserLabels = userLabels.filter((label) => !effectiveHiddenLabelIds.has(label.id));
  const selectedLabelKeys = useMemo(
    () =>
      new Set(
        parseStructuredSearchQuery(searchQuery).filters.flatMap((filter) =>
          filter.type === "label" ? [normalizeLabelSelectionKey(filter.value)] : [],
        ),
      ),
    [searchQuery],
  );

  const setMailboxHiddenLabelIds = (updater: (current: Set<string>) => Set<string>) => {
    if (!mailboxId) return;

    setHiddenLabelState((current) => {
      const currentValue =
        current.mailboxId === mailboxId ? current.value : readHiddenLabelIds(mailboxId);
      const next = updater(new Set(currentValue));
      writeHiddenLabelIds(mailboxId, next);
      return {
        mailboxId,
        value: next,
      };
    });
  };

  const invalidateLabels = async () => {
    if (!mailboxId) return;
    await queryClient.invalidateQueries({ queryKey: getLabelsQueryKey(mailboxId) });
  };

  const createLabelMutation = useMutation(orpc.mail.createLabel.mutationOptions());
  const updateLabelMutation = useMutation(orpc.mail.updateLabel.mutationOptions());
  const deleteLabelMutation = useMutation(orpc.mail.deleteLabel.mutationOptions());
  const isSavingLabel =
    createLabelMutation.isPending || updateLabelMutation.isPending || deleteLabelMutation.isPending;

  const resetEditForm = () => setEditingLabel({ mode: "create", name: "" });

  const submitLabelEdit = async () => {
    if (!mailboxId || !editingLabel) return;
    const name = editingLabel.name.trim();
    if (!name) return;

    try {
      if (editingLabel.mode === "create") {
        const label = await createLabelMutation.mutateAsync({ mailboxId, name });
        if (visibleUserLabels.length >= MAX_VISIBLE_SIDEBAR_LABELS) {
          setMailboxHiddenLabelIds((current) => {
            current.add(label.id);
            return current;
          });
        }
        resetEditForm();
        await invalidateLabels();
        return;
      }

      const previousName = editingLabel.label.name;
      const label = await updateLabelMutation.mutateAsync({
        labelId: editingLabel.label.id,
        mailboxId,
        name,
      });
      resetEditForm();
      await invalidateLabels();
      if (selectedLabelKeys.has(normalizeLabelSelectionKey(previousName))) {
        onSearch(
          updateLabelFilter(updateLabelFilter(searchQuery, previousName, false), label.name, true),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save label.");
    }
  };

  const deleteLabel = async (label: GmailLabelListItem) => {
    if (!mailboxId) return;

    try {
      await deleteLabelMutation.mutateAsync({ labelId: label.id, mailboxId });
      setMailboxHiddenLabelIds((current) => {
        current.delete(label.id);
        return current;
      });
      await invalidateLabels();
      onSearch(updateLabelFilter(searchQuery, label.name, false));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete label.");
    }
  };

  const toggleSidebarVisibility = (labelId: string) => {
    setMailboxHiddenLabelIds((current) => {
      const isShown = !effectiveHiddenLabelIds.has(labelId);
      if (!isShown) {
        if (visibleUserLabels.length >= MAX_VISIBLE_SIDEBAR_LABELS) {
          toast.error("Hide one label before showing another.");
          return current;
        }

        current.delete(labelId);
      } else {
        current.add(labelId);
      }
      return current;
    });
  };

  if (!mailboxId) return null;

  return (
    <section className="mt-4">
      <m.div
        className="mb-1 flex items-center justify-between px-2 will-change-[transform,opacity,filter]"
        initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        transition={{ delay: getSidebarEntranceDelay(8), duration: 0.5, ease: "easeOut" }}
      >
        <p className="text-xs font-medium text-muted-foreground">Labels</p>
        <IconButtonTooltip label="Edit labels">
          <Button
            aria-label="Edit labels"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => {
              resetEditForm();
              setIsEditDialogOpen(true);
            }}
            size="icon-sm"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden className="size-3.5" icon={Edit01Icon} />
          </Button>
        </IconButtonTooltip>
      </m.div>

      <nav aria-label="Labels" className="flex flex-col gap-0.5">
        {labelsQuery.isPending ? (
          <m.p
            className="px-2 py-1 text-xs text-muted-foreground will-change-[transform,opacity,filter]"
            initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
          >
            Loading labels…
          </m.p>
        ) : labelsQuery.isError ? (
          <m.p
            className="px-2 py-1 text-xs text-destructive will-change-[transform,opacity,filter]"
            initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
          >
            Could not load labels.
          </m.p>
        ) : visibleUserLabels.length === 0 ? (
          <m.p
            className="px-2 py-1 text-xs text-muted-foreground will-change-[transform,opacity,filter]"
            initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
          >
            No labels shown.
          </m.p>
        ) : (
          visibleUserLabels.map((label, index) => {
            const isActive = selectedLabelKeys.has(normalizeLabelSelectionKey(label.name));
            return (
              <m.div
                key={label.id}
                className="w-full will-change-[transform,opacity,filter]"
                initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                transition={{
                  delay: getSidebarEntranceDelay(index + 9),
                  duration: 0.5,
                  ease: "easeOut",
                }}
              >
                <Button
                  aria-pressed={isActive}
                  className={cn(
                    "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light text-foreground",
                    {
                      "bg-muted hover:bg-muted": isActive,
                    },
                  )}
                  onClick={() => onSearch(updateLabelFilter(searchQuery, label.name, !isActive))}
                  type="button"
                  variant="ghost"
                  size="sm"
                >
                  <HugeiconsIcon
                    aria-hidden
                    className={cn("shrink-0", {
                      "text-primary": isActive,
                      "text-muted-foreground": !isActive,
                    })}
                    icon={Tag01Icon}
                    strokeWidth={1.5}
                  />
                  <span className="min-w-0 truncate">{label.name}</span>
                </Button>
              </m.div>
            );
          })
        )}
      </nav>

      <Dialog
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) resetEditForm();
        }}
        open={isEditDialogOpen}
      >
        <DialogContent className="w-[min(92vw,34rem)]">
          <DialogHeader>
            <DialogTitle>Edit labels</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4 pt-0">
            <form
              action={() => {
                void submitLabelEdit();
              }}
              className="flex items-center gap-2"
            >
              <Input
                aria-label={editingLabel?.mode === "rename" ? "Rename label" : "New label name"}
                autoFocus
                disabled={isSavingLabel}
                onChange={(event) => {
                  const nextName =
                    event.target instanceof HTMLInputElement ? event.target.value : "";
                  if (editingLabel) {
                    setEditingLabel({ ...editingLabel, name: nextName });
                  } else {
                    setEditingLabel({ mode: "create", name: nextName });
                  }
                }}
                placeholder={editingLabel?.mode === "rename" ? "Rename label" : "New label"}
                value={editingLabel?.name ?? ""}
                size="sm"
              />
              <Button
                disabled={isSavingLabel || !editingLabel?.name.trim()}
                size="sm"
                variant="outline"
                type="submit"
              >
                {editingLabel?.mode === "rename" ? "Save" : "Create"}
              </Button>
            </form>

            <div className="max-h-[min(24rem,48vh)] overflow-y-auto pr-1">
              {labelsQuery.isPending ? (
                <p className="py-3 text-sm text-muted-foreground">Loading labels…</p>
              ) : labelsQuery.isError ? (
                <p className="py-3 text-sm text-destructive">Could not load labels.</p>
              ) : userLabels.length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">No labels yet.</p>
              ) : (
                <div className="flex flex-col">
                  {userLabels.map((label) => {
                    const isShown = !effectiveHiddenLabelIds.has(label.id);
                    return (
                      <div
                        className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-muted/60"
                        key={label.id}
                      >
                        <HugeiconsIcon
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                          icon={Tag01Icon}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{label.name}</span>
                        <IconButtonTooltip label={isShown ? "Hide in sidebar" : "Show in sidebar"}>
                          <Button
                            aria-label={isShown ? "Hide in sidebar" : "Show in sidebar"}
                            aria-pressed={isShown}
                            className={cn(
                              "-mr-3 size-7 text-muted-foreground hover:text-foreground",
                              {
                                "text-foreground": isShown,
                              },
                            )}
                            onClick={() => toggleSidebarVisibility(label.id)}
                            size="icon-sm"
                            type="button"
                            variant="ghost"
                          >
                            {isShown ? (
                              <EyeIcon aria-hidden className="size-4" />
                            ) : (
                              <EyeOffIcon aria-hidden className="size-4" />
                            )}
                          </Button>
                        </IconButtonTooltip>
                        <DropdownMenu>
                          <IconButtonTooltip label={`${label.name} options`}>
                            <DropdownMenuTrigger
                              aria-label={`${label.name} options`}
                              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
                            >
                              <HugeiconsIcon
                                aria-hidden
                                className="size-3.5"
                                icon={MoreVerticalIcon}
                              />
                            </DropdownMenuTrigger>
                          </IconButtonTooltip>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                setEditingLabel({ label, mode: "rename", name: label.name })
                              }
                            >
                              <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive"
                              onSelect={() => void deleteLabel(label)}
                            >
                              <HugeiconsIcon aria-hidden className="size-4" icon={Delete01Icon} />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter className="pt-0">
            <DialogCloseButton>Done</DialogCloseButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
