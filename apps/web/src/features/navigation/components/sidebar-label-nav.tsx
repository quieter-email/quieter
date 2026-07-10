"use client";

import type { MailboxLabel, MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import type { ReactNode } from "react";
import {
  ArrowLeft02Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Delete01Icon,
  Edit01Icon,
  MoreVerticalIcon,
  Tag01Icon,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import {
  FullPageDialog,
  FullPageDialogBody,
  FullPageDialogClose,
  FullPageDialogContent,
  FullPageDialogDescription,
  FullPageDialogHeader,
  FullPageDialogTitle,
} from "@quieter/ui/full-page-dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutGroup, m } from "motion/react";
import { useEffect, useReducer, useState } from "react";
import { MailboxColorPicker } from "~/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "~/features/message-labels/domain/mailbox-label-presentation";
import { serializeStructuredSearchState } from "~/features/message-search/components/message-list-search/message-list-search-utils";
import {
  getUserLabels,
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "~/features/message-search/state/message-list-search-state";
import { SidebarNavItem } from "~/features/navigation/components/sidebar-nav-item";
import { useSidebarNavHover } from "~/features/navigation/hooks/use-sidebar-nav-hover";
import { getLabelsQueryKey, labelsQueryOptions } from "~/lib/gmail/labels-query";
import {
  getManagedLabelCountsQueryKey,
  managedLabelCountsQueryOptions,
} from "~/lib/managed-mailbox-organization-query";
import { orpc } from "~/lib/orpc";

type SidebarLabelNavProps = {
  animateEntrance: boolean;
  canManage: boolean;
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
  onSearch: (query: string) => void;
  searchQuery: string;
};

type EditingLabel = { color: MailboxLabelColor; label: MailboxLabel; name: string } | null;

type HiddenLabelState = {
  mailboxId: string | null;
  value: Set<string>;
};

type HiddenLabelAction = {
  mailboxId: string;
  updater: (current: Set<string>) => Set<string>;
};

type EditingLabelDetails = {
  description: string;
  inclusionCriteria: string;
  labelId: string;
};

const MAX_VISIBLE_SIDEBAR_LABELS = 10;
const SIDEBAR_LABEL_VISIBILITY_STORAGE_KEY = "quieter:sidebar-label-visibility";
const ManagedLabelColorDot = ({
  className,
  color,
}: {
  className?: string;
  color: MailboxLabelColor | null | undefined;
}) => (
  <span
    aria-hidden
    className={cn(
      "inline-flex size-3 shrink-0 rounded-full",
      mailboxLabelDotClassNameByColor[color ?? "gray"],
      className,
    )}
  />
);

const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;

const SidebarLabelEntrance = ({
  animateEntrance,
  children,
  delayOffset,
  index,
}: {
  animateEntrance: boolean;
  children: ReactNode;
  delayOffset: number;
  index: number;
}) => {
  const [entrance] = useState(() => ({
    animate: animateEntrance,
    delay: delayOffset + getSidebarEntranceDelay(index),
  }));

  return (
    <m.div
      className="w-full will-change-[transform,opacity,filter]"
      initial={getSidebarEntranceInitial(entrance.animate)}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ delay: entrance.delay, duration: 0.5, ease: "easeOut" }}
    >
      {children}
    </m.div>
  );
};

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

const createHiddenLabelState = (mailboxId: string | null): HiddenLabelState => ({
  mailboxId,
  value: readHiddenLabelIds(mailboxId),
});

const reduceHiddenLabelState = (
  current: HiddenLabelState,
  { mailboxId, updater }: HiddenLabelAction,
): HiddenLabelState => {
  const currentValue =
    current.mailboxId === mailboxId ? current.value : readHiddenLabelIds(mailboxId);
  const next = updater(new Set(currentValue));
  writeHiddenLabelIds(mailboxId, next);
  return {
    mailboxId,
    value: next,
  };
};

export const SidebarLabelNav = ({
  animateEntrance,
  canManage,
  mailboxId,
  mailboxProvider,
  onSearch,
  searchQuery,
}: SidebarLabelNavProps) => {
  const shouldAnimateEntrance = animateEntrance;
  const queryClient = useQueryClient();
  const [newLabelColor, setNewLabelColor] = useState<MailboxLabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");
  const [editingLabel, setEditingLabel] = useState<EditingLabel>(null);
  const [editingLabelDetails, setEditingLabelDetails] = useState<EditingLabelDetails | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<MailboxLabel | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const {
    clearHover: clearLabelHover,
    clearHoverIfLeavingNav: clearLabelHoverIfLeavingNav,
    hoverEnter,
    hoverLayoutId,
    isHoverExiting,
    isHovered,
    navRef: labelNavRef,
    onHoverExitComplete,
    setHover: setLabelHover,
  } = useSidebarNavHover<string>("label-sidebar-hover");
  const [hiddenLabelState, updateHiddenLabelState] = useReducer(
    reduceHiddenLabelState,
    mailboxId,
    createHiddenLabelState,
  );
  const {
    data: labels,
    isError: areLabelsError,
    isPending: areLabelsPending,
  } = useQuery(labelsQueryOptions(mailboxId ?? "", !!mailboxId));
  const labelsUnavailable = areLabelsError && !labels;

  const [isLabelEntranceSlotOpen, openLabelEntranceSlot] = useReducer(() => true, !animateEntrance);

  useEffect(() => {
    if (isLabelEntranceSlotOpen) return;

    const timeout = window.setTimeout(openLabelEntranceSlot, getSidebarEntranceDelay(9) * 1000);
    return () => window.clearTimeout(timeout);
  }, [isLabelEntranceSlotOpen]);

  const { data: managedLabelCounts = [] } = useQuery(
    managedLabelCountsQueryOptions(mailboxId ?? "", mailboxProvider === "managed" && !!mailboxId),
  );
  const managedLabelCountById = new Map(
    managedLabelCounts.map((record) => [record.labelId, Number(record.count)]),
  );
  const userLabels = getUserLabels(labels ?? []);
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = new Set<string>();
  if (mailboxProvider === "managed") {
    for (const label of userLabels) {
      if (!label.visible) effectiveHiddenLabelIds.add(label.id);
    }
  } else {
    for (const labelId of hiddenLabelIds) {
      effectiveHiddenLabelIds.add(labelId);
    }

    let visibleLabelCount = 0;
    for (const label of userLabels) {
      if (hiddenLabelIds.has(label.id)) continue;
      if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
        effectiveHiddenLabelIds.add(label.id);
        continue;
      }
      visibleLabelCount += 1;
    }
  }
  const visibleUserLabels = userLabels.filter((label) => !effectiveHiddenLabelIds.has(label.id));
  const selectedLabelKeys = new Set(
    parseStructuredSearchQuery(searchQuery).filters.flatMap((filter) =>
      filter.type === "label" ? [normalizeLabelSelectionKey(filter.value)] : [],
    ),
  );
  const labelNoun = "label";
  const labelNounPlural = "labels";
  const labelTitle = "Labels";
  const labelTitleSingular = "Label";

  const setMailboxHiddenLabelIds = (updater: (current: Set<string>) => Set<string>) => {
    if (!mailboxId) return;
    updateHiddenLabelState({ mailboxId, updater });
  };

  const invalidateLabels = async () => {
    if (!mailboxId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getLabelsQueryKey(mailboxId) }),
      ...(mailboxProvider === "managed"
        ? [
            queryClient.invalidateQueries({
              queryKey: getManagedLabelCountsQueryKey(mailboxId),
            }),
          ]
        : []),
    ]);
  };

  const createLabelMutation = useMutation(orpc.mail.createLabel.mutationOptions());
  const updateLabelMutation = useMutation(orpc.mail.updateLabel.mutationOptions());
  const deleteLabelMutation = useMutation(orpc.mail.deleteLabel.mutationOptions());
  const updateLabelDetailsMutation = useMutation(orpc.mail.updateLabelDetails.mutationOptions());
  const reorderLabelsMutation = useMutation(orpc.mail.reorderManagedLabels.mutationOptions());

  const resetLabelForms = () => {
    setEditingLabel(null);
    setNewLabelColor("gray");
    setNewLabelName("");
  };

  const createLabel = async () => {
    if (!mailboxId) return;
    const name = newLabelName.trim();
    if (!name) return;

    try {
      const label = await createLabelMutation.mutateAsync({
        color: newLabelColor,
        mailboxId,
        name,
      });
      if (visibleUserLabels.length >= MAX_VISIBLE_SIDEBAR_LABELS) {
        setMailboxHiddenLabelIds((current) => {
          current.add(label.id);
          return current;
        });
      }
      setNewLabelColor("gray");
      setNewLabelName("");
      await invalidateLabels();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not create ${labelNoun}.`);
    }
  };

  const saveLabelEdit = async () => {
    if (!mailboxId || !editingLabel) return;
    const name = editingLabel.name.trim();
    if (!name) return;

    try {
      const previousName = editingLabel.label.name;
      const label = await updateLabelMutation.mutateAsync({
        labelId: editingLabel.label.id,
        mailboxId,
        name,
        color: editingLabel.color,
      });
      setEditingLabel(null);
      await invalidateLabels();
      if (selectedLabelKeys.has(normalizeLabelSelectionKey(previousName))) {
        onSearch(
          updateLabelFilter(updateLabelFilter(searchQuery, previousName, false), label.name, true),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not update ${labelNoun}.`);
    }
  };

  const deleteLabel = async (label: MailboxLabel) => {
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
      setDeletingLabel(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not delete ${labelNoun}.`);
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
      toast.success(`${labelTitleSingular} explanation saved.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Could not save ${labelNoun} explanation.`,
      );
    }
  };

  const toggleSidebarVisibility = (labelId: string) => {
    if (!mailboxId) return;
    if (mailboxProvider === "managed") {
      const label = userLabels.find((candidate) => candidate.id === labelId);
      if (!label) return;
      void updateLabelMutation
        .mutateAsync({
          labelId,
          mailboxId,
          name: label.name,
          visible: effectiveHiddenLabelIds.has(labelId),
        })
        .then(invalidateLabels)
        .catch((error) => {
          toast.error(error instanceof Error ? error.message : `Could not update ${labelNoun}.`);
        });
      return;
    }

    setMailboxHiddenLabelIds((current) => {
      const isShown = !effectiveHiddenLabelIds.has(labelId);
      if (!isShown) {
        if (visibleUserLabels.length >= MAX_VISIBLE_SIDEBAR_LABELS) {
          toast.error(`Hide one ${labelNoun} before showing another.`);
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
        <p className="text-xs font-medium text-muted-foreground">{labelTitle}</p>
        {canManage && (
          <IconButtonTooltip label={`Edit ${labelNounPlural}`}>
            <Button
              aria-label={`Edit ${labelNounPlural}`}
              className="size-6 text-muted-foreground hover:text-foreground"
              onClick={() => {
                resetLabelForms();
                setIsEditDialogOpen(true);
              }}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon aria-hidden className="size-3.5" icon={Edit01Icon} />
            </Button>
          </IconButtonTooltip>
        )}
      </m.div>

      <LayoutGroup id="label-sidebar">
        <nav
          ref={labelNavRef}
          aria-label={labelTitle}
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
              Loading {labelNounPlural}…
            </m.p>
          ) : !isLabelEntranceSlotOpen ? null : labelsUnavailable ? (
            <m.p
              className="px-2 py-1 text-xs text-destructive will-change-[transform,opacity,filter]"
              initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
            >
              Could not load {labelNounPlural}.
            </m.p>
          ) : visibleUserLabels.length === 0 ? (
            <m.p
              className="px-2 py-1 text-xs text-muted-foreground will-change-[transform,opacity,filter]"
              initial={getSidebarEntranceInitial(shouldAnimateEntrance)}
              animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
              transition={{ delay: getSidebarEntranceDelay(9), duration: 0.5, ease: "easeOut" }}
            >
              No {labelNounPlural} shown.
            </m.p>
          ) : (
            visibleUserLabels.map((label, index) => {
              const isActive = selectedLabelKeys.has(normalizeLabelSelectionKey(label.name));
              const labelHovered = isHovered(label.id);
              const labelHoverExiting = isHoverExiting(label.id);

              return (
                <SidebarLabelEntrance key={label.id} animateEntrance delayOffset={0} index={index}>
                  <SidebarNavItem
                    active={isActive}
                    aria-pressed={isActive}
                    className={cn(
                      "h-7 w-full min-w-0 justify-start gap-2 rounded-md px-2.5 text-left text-xs font-light squircle",
                      {
                        "text-foreground": isActive || labelHovered,
                        "text-muted-foreground": !isActive && !labelHovered,
                      },
                    )}
                    hover={labelHovered}
                    hoverEnter={labelHovered && hoverEnter}
                    hoverExiting={labelHoverExiting}
                    hoverLayoutId={hoverLayoutId}
                    onBlur={(event) => clearLabelHoverIfLeavingNav(event.relatedTarget)}
                    onClick={() => onSearch(updateLabelFilter(searchQuery, label.name, !isActive))}
                    onFocus={() => {
                      if (isActive) {
                        clearLabelHover();
                        return;
                      }
                      setLabelHover(label.id);
                    }}
                    onHoverExitComplete={onHoverExitComplete}
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
                    <ManagedLabelColorDot color={label.color} />
                    <span className="min-w-0 truncate">{label.name}</span>
                    {mailboxProvider === "managed" ? (
                      <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                        {managedLabelCountById.get(label.id) ?? 0}
                      </span>
                    ) : null}
                  </SidebarNavItem>
                </SidebarLabelEntrance>
              );
            })
          )}
        </nav>
      </LayoutGroup>

      <FullPageDialog
        onOpenChange={(open) => {
          setIsEditDialogOpen(open);
          if (!open) resetLabelForms();
        }}
        open={isEditDialogOpen}
      >
        <FullPageDialogContent>
          <FullPageDialogHeader>
            <IconButtonTooltip label={`Close ${labelNoun} editor`}>
              <FullPageDialogClose aria-label={`Close ${labelNoun} editor`}>
                <HugeiconsIcon aria-hidden icon={ArrowLeft02Icon} />
              </FullPageDialogClose>
            </IconButtonTooltip>
            <FullPageDialogTitle>Edit {labelNounPlural}</FullPageDialogTitle>
          </FullPageDialogHeader>
          <FullPageDialogBody>
            <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
              <div className="mb-8">
                <h2 className="text-xl font-semibold tracking-tight">{labelTitle}</h2>
                <FullPageDialogDescription className="mt-1">
                  Create {labelNounPlural}, choose which ones appear in your sidebar, and explain
                  what belongs in each one.
                </FullPageDialogDescription>
              </div>
              <form
                action={() => {
                  void createLabel();
                }}
                className="mb-8 flex flex-wrap items-center gap-3 rounded-xl bg-secondary/40 p-3 squircle"
              >
                <Input
                  aria-label={`New ${labelNoun} name`}
                  autoFocus
                  className="min-w-48 flex-1 border-0 bg-background/70 shadow-none"
                  disabled={createLabelMutation.isPending}
                  onChange={(event) => setNewLabelName(event.currentTarget.value)}
                  placeholder={`New ${labelNoun}`}
                  size="sm"
                  value={newLabelName}
                />
                <MailboxColorPicker
                  className="shrink-0"
                  label={`${labelTitleSingular} color`}
                  onChange={setNewLabelColor}
                  value={newLabelColor}
                />
                <Button
                  disabled={createLabelMutation.isPending || !newLabelName.trim()}
                  size="sm"
                  type="submit"
                >
                  Create
                </Button>
              </form>

              <div>
                {areLabelsPending ? (
                  <p className="py-3 text-sm text-muted-foreground">Loading {labelNounPlural}…</p>
                ) : labelsUnavailable ? (
                  <p className="py-3 text-sm text-destructive">Could not load {labelNounPlural}.</p>
                ) : userLabels.length === 0 ? (
                  <p className="py-3 text-sm text-muted-foreground">No {labelNounPlural} yet.</p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {userLabels.map((label, index) => {
                      const isShown = !effectiveHiddenLabelIds.has(label.id);
                      const labelDetails =
                        editingLabelDetails?.labelId === label.id ? editingLabelDetails : null;
                      return (
                        <div className="rounded-lg" key={label.id}>
                          <div className="flex min-h-12 items-center gap-3 px-2 squircle hover:bg-background/50">
                            <ManagedLabelColorDot className="size-4" color={label.color} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{label.name}</p>
                              {(label.description || label.inclusionCriteria) && (
                                <p className="truncate text-xs text-muted-foreground">
                                  {label.description || label.inclusionCriteria}
                                </p>
                              )}
                            </div>
                            {mailboxProvider === "managed" ? (
                              <div className="flex items-center">
                                <IconButtonTooltip label={`Move ${label.name} up`}>
                                  <Button
                                    aria-label={`Move ${label.name} up`}
                                    disabled={index === 0 || reorderLabelsMutation.isPending}
                                    onClick={() => {
                                      const labelIds = userLabels.map((candidate) => candidate.id);
                                      [labelIds[index - 1], labelIds[index]] = [
                                        labelIds[index],
                                        labelIds[index - 1],
                                      ];
                                      void reorderLabelsMutation
                                        .mutateAsync({ labelIds, mailboxId })
                                        .then(invalidateLabels);
                                    }}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <HugeiconsIcon aria-hidden icon={ArrowUp01Icon} />
                                  </Button>
                                </IconButtonTooltip>
                                <IconButtonTooltip label={`Move ${label.name} down`}>
                                  <Button
                                    aria-label={`Move ${label.name} down`}
                                    disabled={
                                      index === userLabels.length - 1 ||
                                      reorderLabelsMutation.isPending
                                    }
                                    onClick={() => {
                                      const labelIds = userLabels.map((candidate) => candidate.id);
                                      [labelIds[index], labelIds[index + 1]] = [
                                        labelIds[index + 1],
                                        labelIds[index],
                                      ];
                                      void reorderLabelsMutation
                                        .mutateAsync({ labelIds, mailboxId })
                                        .then(invalidateLabels);
                                    }}
                                    size="icon-sm"
                                    type="button"
                                    variant="ghost"
                                  >
                                    <HugeiconsIcon aria-hidden icon={ArrowDown01Icon} />
                                  </Button>
                                </IconButtonTooltip>
                              </div>
                            ) : null}
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
                                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-background/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/20"
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
                                    setEditingLabel({
                                      color: label.color ?? "gray",
                                      label,
                                      name: label.name,
                                    })
                                  }
                                >
                                  <HugeiconsIcon aria-hidden className="size-4" icon={Edit01Icon} />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onSelect={() => setDeletingLabel(label)}
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
                                <FieldLabel>What this {labelNoun} is for</FieldLabel>
                                <textarea
                                  aria-label={`What this ${labelNoun} is for`}
                                  className="keyboard-focus-ring min-h-20 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none squircle placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={updateLabelDetailsMutation.isPending}
                                  maxLength={2000}
                                  onChange={(event) => {
                                    const description = event.currentTarget.value;
                                    setEditingLabelDetails((current) =>
                                      current ? { ...current, description } : current,
                                    );
                                  }}
                                  placeholder={`A short explanation of the ${labelNoun}'s purpose.`}
                                  value={labelDetails.description}
                                />
                                <FieldDescription>
                                  Describe the topic or workflow this {labelNoun} represents.
                                </FieldDescription>
                              </Field>
                              {mailboxProvider === "gmail" ? (
                                <Field>
                                  <FieldLabel>Emails to include</FieldLabel>
                                  <textarea
                                    aria-label="Emails to include"
                                    className="keyboard-focus-ring min-h-24 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm outline-none squircle placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
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
                                    Explain the senders, subjects, content, or situations that
                                    belong here.
                                  </FieldDescription>
                                </Field>
                              ) : null}
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
      <Dialog
        onOpenChange={(open) => {
          if (!open) setEditingLabel(null);
        }}
        open={!!editingLabel}
      >
        <DialogContent className="w-[min(92vw,24rem)] border-0 bg-popover shadow-lg">
          <form
            action={() => {
              void saveLabelEdit();
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit {labelNoun}</DialogTitle>
              <DialogDescription>Change its name and color together.</DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-5 bg-secondary/25">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input
                  autoFocus
                  className="border-0 bg-background/70 shadow-none"
                  disabled={updateLabelMutation.isPending}
                  onChange={(event) => {
                    const name = event.currentTarget.value;
                    setEditingLabel((current) => (current ? { ...current, name } : current));
                  }}
                  value={editingLabel?.name ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel>Color</FieldLabel>
                <MailboxColorPicker
                  label={`${labelTitleSingular} color`}
                  onChange={(color) =>
                    setEditingLabel((current) => (current ? { ...current, color } : current))
                  }
                  value={editingLabel?.color ?? "gray"}
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <DialogCloseButton variant="ghost">Cancel</DialogCloseButton>
              <Button
                disabled={updateLabelMutation.isPending || !editingLabel?.name.trim()}
                size="sm"
                type="submit"
              >
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setDeletingLabel(null);
        }}
        open={!!deletingLabel}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {labelNoun}</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the {labelNoun} from conversations, saved views, and automatic rules.
              Rules or views left without usable settings will be disabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <p className="text-sm text-foreground">
              Delete {deletingLabel?.name ? `"${deletingLabel.name}"` : `this ${labelNoun}`}?
            </p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton>Cancel</AlertDialogCloseButton>
            <Button
              disabled={deleteLabelMutation.isPending || !deletingLabel}
              onClick={() => {
                if (deletingLabel) void deleteLabel(deletingLabel);
              }}
              variant="destructive"
            >
              Delete {labelNoun}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
