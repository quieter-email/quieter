"use client";

import {
  ArrowLeft02Icon,
  Delete01Icon,
  Edit01Icon,
  MoreVerticalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EyeIcon,
  EyeOffIcon,
  Field,
  FieldDescription,
  FieldLabel,
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogDescription,
  FullPageDialogHeader,
  FullPageDialogTitle,
  IconButtonTooltip,
  Input,
  cn,
  toast,
} from "@quieter/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup, m } from "motion/react";
import { useRef, useState } from "react";
import type { GmailLabelListItem } from "~/lib/gmail/gmail";
import { serializeStructuredSearchState } from "~/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "~/features/message-search/state/message-list-search-state";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";
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

type EditingLabelDetails = {
  description: string;
  inclusionCriteria: string;
  labelId: string;
};

const MAX_VISIBLE_SIDEBAR_LABELS = 10;
const SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY = "quieter:sidebar-label-visibility";

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;

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
  const [editingLabelDetails, setEditingLabelDetails] = useState<EditingLabelDetails | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const labelNavRef = useRef<HTMLElement>(null);
  const [hoveredLabelId, setHoveredLabelId] = useState<string | null>(null);
  const [exitingLabelId, setExitingLabelId] = useState<string | null>(null);
  const hoverEnterRef = useRef(false);

  const setLabelHover = (labelId: string) => {
    hoverEnterRef.current = hoveredLabelId === null && exitingLabelId === null;
    setExitingLabelId(null);
    setHoveredLabelId(labelId);
  };

  const clearLabelHover = () => {
    if (hoveredLabelId !== null) {
      setExitingLabelId(hoveredLabelId);
    }
    hoverEnterRef.current = false;
    setHoveredLabelId(null);
  };

  const clearLabelHoverIfLeavingNav = (nextTarget: EventTarget | null) => {
    if (!nextTarget || !labelNavRef.current?.contains(nextTarget as Node)) {
      clearLabelHover();
    }
  };
  const [hiddenLabelState, setHiddenLabelState] = useState<HiddenLabelState>(() => ({
    mailboxId,
    value: readHiddenLabelIds(mailboxId),
  }));
  const {
    data: labels,
    isError: areLabelsError,
    isPending: areLabelsPending,
  } = useQuery(labelsQueryOptions(mailboxId ?? "", !!mailboxId));
  const userLabels = getUserLabels(labels ?? []);
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
  const selectedLabelKeys = new Set(
    parseStructuredSearchQuery(searchQuery).filters.flatMap((filter) =>
      filter.type === "label" ? [normalizeLabelSelectionKey(filter.value)] : [],
    ),
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
  const updateLabelDetailsMutation = useMutation(orpc.mail.updateLabelDetails.mutationOptions());
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
      if (editingLabelDetails?.labelId === label.id) {
        setEditingLabelDetails(null);
      }
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

  const saveLabelDetails = async () => {
    if (!mailboxId || !editingLabelDetails) return;

    try {
      await updateLabelDetailsMutation.mutateAsync({
        description: editingLabelDetails.description.trim() || null,
        inclusionCriteria: editingLabelDetails.inclusionCriteria.trim() || null,
        labelId: editingLabelDetails.labelId,
        mailboxId,
      });
      setEditingLabelDetails(null);
      await invalidateLabels();
      toast.success("Label explanation saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save label explanation.");
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

      <LayoutGroup id="label-sidebar">
        <nav
          ref={labelNavRef}
          aria-label="Labels"
          className="flex flex-col"
          onMouseLeave={clearLabelHover}
        >
          {areLabelsPending ? (
            <m.p
              className="px-2 py-1 text-xs text-muted-foreground will-change-[transform,opacity,filter]"
              initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
            >
              Loading labels…
            </m.p>
          ) : areLabelsError ? (
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
              const isHovered = hoveredLabelId === label.id;
              const isHoverExiting = exitingLabelId === label.id;

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
                  <SidebarNavItem
                    active={isActive}
                    aria-pressed={isActive}
                    className={cn(
                      "squircle h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light",
                      {
                        "text-foreground": isActive || isHovered,
                        "text-muted-foreground": !isActive && !isHovered,
                      },
                    )}
                    hover={isHovered}
                    hoverEnter={isHovered && hoverEnterRef.current}
                    hoverExiting={isHoverExiting}
                    hoverLayoutId="label-sidebar-hover"
                    onBlur={(event) => clearLabelHoverIfLeavingNav(event.relatedTarget)}
                    onClick={() => onSearch(updateLabelFilter(searchQuery, label.name, !isActive))}
                    onFocus={() => {
                      if (!isActive) setLabelHover(label.id);
                    }}
                    onHoverExitComplete={() => setExitingLabelId(null)}
                    onMouseEnter={() => {
                      if (isActive) {
                        clearLabelHover();
                        return;
                      }
                      setLabelHover(label.id);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <HugeiconsIcon
                      aria-hidden
                      className={cn("shrink-0", {
                        "text-primary": isActive,
                        "text-foreground": !isActive && isHovered,
                        "text-muted-foreground": !isActive && !isHovered,
                      })}
                      icon={Tag01Icon}
                      strokeWidth={1.5}
                    />
                    <span className="min-w-0 truncate">{label.name}</span>
                  </SidebarNavItem>
                </m.div>
              );
            })
          )}
        </nav>
      </LayoutGroup>

      <FullPageDialog
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) resetEditForm();
        }}
        open={isEditDialogOpen}
      >
        <FullPageDialogContent>
          <FullPageDialogHeader>
            <IconButtonTooltip label="Close label editor">
              <FullPageDialogClose aria-label="Close label editor">
                <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
              </FullPageDialogClose>
            </IconButtonTooltip>
            <FullPageDialogTitle>Edit labels</FullPageDialogTitle>
          </FullPageDialogHeader>
          <FullPageDialogBody>
            <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
              <div className="mb-8">
                <h2 className="text-xl font-semibold tracking-tight">Labels</h2>
                <FullPageDialogDescription className="mt-1">
                  Create labels, choose which ones appear in your sidebar, and explain what belongs
                  in each one.
                </FullPageDialogDescription>
              </div>
              <form
                action={() => {
                  void submitLabelEdit();
                }}
                className="mb-8 flex items-center gap-2 border-b pb-8"
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

              <div>
                {areLabelsPending ? (
                  <p className="py-3 text-sm text-muted-foreground">Loading labels…</p>
                ) : areLabelsError ? (
                  <p className="py-3 text-sm text-destructive">Could not load labels.</p>
                ) : userLabels.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No labels yet.</p>
                ) : (
                  <div className="flex flex-col">
                    {userLabels.map((label) => {
                      const isShown = !effectiveHiddenLabelIds.has(label.id);
                      const labelDetails =
                        editingLabelDetails?.labelId === label.id ? editingLabelDetails : null;
                      return (
                        <div className="border-b last:border-b-0" key={label.id}>
                          <div className="flex min-h-12 items-center gap-3 px-2 hover:bg-muted/60">
                            <HugeiconsIcon
                              aria-hidden
                              className="size-4 shrink-0 text-muted-foreground"
                              icon={Tag01Icon}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{label.name}</p>
                              {(label.description || label.inclusionCriteria) && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {label.description || label.inclusionCriteria}
                                </p>
                              )}
                            </div>
                            <IconButtonTooltip
                              label={isShown ? "Hide in sidebar" : "Show in sidebar"}
                            >
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
                                    setEditingLabelDetails({
                                      description: label.description ?? "",
                                      inclusionCriteria: label.inclusionCriteria ?? "",
                                      labelId: label.id,
                                    })
                                  }
                                >
                                  <HugeiconsIcon aria-hidden className="size-4" icon={Tag01Icon} />
                                  Explain label
                                </DropdownMenuItem>
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
                                  <HugeiconsIcon
                                    aria-hidden
                                    className="size-4"
                                    icon={Delete01Icon}
                                  />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          {labelDetails && (
                            <form
                              action={() => {
                                void saveLabelDetails();
                              }}
                              className="space-y-5 bg-muted/30 px-9 py-5"
                            >
                              <Field>
                                <FieldLabel>What this label is for</FieldLabel>
                                <textarea
                                  aria-label="What this label is for"
                                  className="squircle min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={updateLabelDetailsMutation.isPending}
                                  maxLength={2000}
                                  onChange={(event) => {
                                    const description = event.currentTarget.value;
                                    setEditingLabelDetails((current) =>
                                      current ? { ...current, description } : current,
                                    );
                                  }}
                                  placeholder="A short explanation of the label's purpose."
                                  value={labelDetails.description}
                                />
                                <FieldDescription>
                                  Describe the topic or workflow this label represents.
                                </FieldDescription>
                              </Field>
                              <Field>
                                <FieldLabel>Emails to include</FieldLabel>
                                <textarea
                                  aria-label="Emails to include"
                                  className="squircle min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={updateLabelDetailsMutation.isPending}
                                  maxLength={4000}
                                  onChange={(event) => {
                                    const inclusionCriteria = event.currentTarget.value;
                                    setEditingLabelDetails((current) =>
                                      current ? { ...current, inclusionCriteria } : current,
                                    );
                                  }}
                                  placeholder="For example: invoices, receipts, and payment confirmations from vendors."
                                  value={labelDetails.inclusionCriteria}
                                />
                                <FieldDescription>
                                  Explain the senders, subjects, content, or situations that belong
                                  here.
                                </FieldDescription>
                              </Field>
                              <div className="flex justify-end gap-2">
                                <Button
                                  disabled={updateLabelDetailsMutation.isPending}
                                  onClick={() => setEditingLabelDetails(null)}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  disabled={updateLabelDetailsMutation.isPending}
                                  size="sm"
                                  type="submit"
                                >
                                  Save explanation
                                </Button>
                              </div>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </FullPageDialogBody>
        </FullPageDialogContent>
      </FullPageDialog>
    </section>
  );
};
