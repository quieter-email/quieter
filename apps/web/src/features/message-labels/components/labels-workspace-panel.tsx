"use client";

import {
  Cancel01Icon,
  Delete01Icon,
  Edit01Icon,
  MoreVerticalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  MailboxLabel,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { EyeIcon, EyeOffIcon } from "@quieter/ui/icons";
import { Input } from "@quieter/ui/input";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";

import { MailboxColorPicker } from "#/features/message-labels/components/mailbox-color-picker";
import { mailboxLabelDotClassNameByColor } from "#/features/message-labels/domain/mailbox-label-presentation";
import {
  MAX_VISIBLE_SIDEBAR_LABELS,
  SIDEBAR_LABEL_VISIBILITY_EVENT,
  computeEffectiveHiddenLabelIds,
  createHiddenLabelState,
  readHiddenLabelIds,
  reduceHiddenLabelState,
} from "#/features/message-labels/domain/sidebar-label-visibility";
import { getUserLabels } from "#/features/message-search/state/message-list-search-state";
import { toastError } from "#/lib/error-toast";
import {
  getLabelsQueryKey,
  labelsQueryOptions,
} from "#/lib/gmail/labels-query";
import {
  getManagedLabelCountsQueryKey,
  managedLabelCountsQueryOptions,
} from "#/lib/managed-mailbox-organization-query";
import { orpc } from "#/lib/orpc";

type LabelsWorkspacePanelProps = {
  mailboxId: string | null;
  mailboxProvider: "gmail" | "managed";
};

const isNonemptyMailboxId = (
  mailboxId: string | null | undefined
): mailboxId is string => (mailboxId?.trim() ?? "") !== "";

export const LabelsWorkspacePanel = ({
  mailboxId,
  mailboxProvider,
}: LabelsWorkspacePanelProps) => {
  const queryClient = useQueryClient();
  const [newLabelColor, setNewLabelColor] = useState<MailboxLabelColor>("gray");
  const [newLabelName, setNewLabelName] = useState("");
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<MailboxLabelColor>("gray");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftName, setDraftName] = useState("");
  const [deletingLabel, setDeletingLabel] = useState<MailboxLabel | null>(null);
  const [hiddenLabelState, updateHiddenLabelState] = useReducer(
    reduceHiddenLabelState,
    mailboxId,
    createHiddenLabelState
  );
  const {
    data: labels,
    isError: areLabelsError,
    isPending: areLabelsPending,
  } = useQuery(
    labelsQueryOptions(mailboxId ?? "", isNonemptyMailboxId(mailboxId))
  );
  const labelsUnavailable = areLabelsError && labels === undefined;

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!isNonemptyMailboxId(mailboxId)) {
        return;
      }
      updateHiddenLabelState({
        mailboxId,
        updater: () => readHiddenLabelIds(mailboxId),
      });
    };
    window.addEventListener(
      SIDEBAR_LABEL_VISIBILITY_EVENT,
      handleVisibilityChange
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_LABEL_VISIBILITY_EVENT,
        handleVisibilityChange
      );
    };
  }, [mailboxId]);

  const { data: managedLabelCounts = [] } = useQuery(
    managedLabelCountsQueryOptions(
      mailboxId ?? "",
      mailboxProvider === "managed" && isNonemptyMailboxId(mailboxId)
    )
  );
  const managedLabelCountById = new Map(
    managedLabelCounts.map((record) => [record.labelId, record.count])
  );

  const userLabels = getUserLabels(labels ?? []);
  const hiddenLabelIds =
    hiddenLabelState.mailboxId === mailboxId
      ? hiddenLabelState.value
      : readHiddenLabelIds(mailboxId);
  const effectiveHiddenLabelIds = computeEffectiveHiddenLabelIds(
    mailboxProvider,
    userLabels,
    hiddenLabelIds
  );
  const visibleLabelCount = userLabels.filter(
    (label) => !effectiveHiddenLabelIds.has(label.id)
  ).length;

  const createLabelMutation = useMutation(
    orpc.mail.createLabel.mutationOptions()
  );
  const updateLabelMutation = useMutation(
    orpc.mail.updateLabel.mutationOptions()
  );
  const deleteLabelMutation = useMutation(
    orpc.mail.deleteLabel.mutationOptions()
  );
  const updateLabelDetailsMutation = useMutation(
    orpc.mail.updateLabelDetails.mutationOptions()
  );

  const setMailboxHiddenLabelIds = (
    updater: (current: Set<string>) => Set<string>
  ) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    updateHiddenLabelState({ mailboxId, updater });
  };

  const invalidateLabels = async () => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
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

  const createLabel = async () => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    const name = newLabelName.trim();
    if (name === "") {
      return;
    }

    try {
      const label = await createLabelMutation.mutateAsync({
        color: newLabelColor,
        mailboxId,
        name,
      });
      if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
        setMailboxHiddenLabelIds((current) => {
          current.add(label.id);
          return current;
        });
      }
      setNewLabelColor("gray");
      setNewLabelName("");
      await invalidateLabels();
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not create label.",
      });
    }
  };

  const startEditing = (label: MailboxLabel) => {
    setEditingLabelId(label.id);
    setDraftName(label.name);
    setDraftDescription(label.description ?? label.inclusionCriteria ?? "");
    setDraftColor(label.color ?? "gray");
  };

  const cancelEditing = () => {
    setEditingLabelId(null);
  };

  const saveLabelEdit = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    const name = draftName.trim();
    if (name === "") {
      return;
    }

    try {
      await updateLabelMutation.mutateAsync({
        color: draftColor,
        labelId: label.id,
        mailboxId,
        name,
      });
      await updateLabelDetailsMutation.mutateAsync({
        description: draftDescription.trim() === "" ? null : draftDescription,
        inclusionCriteria: label.inclusionCriteria ?? null,
        labelId: label.id,
        mailboxId,
      });
      setEditingLabelId(null);
      await invalidateLabels();
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not update label.",
      });
    }
  };

  const toggleSidebarVisibility = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }
    if (mailboxProvider === "managed") {
      try {
        await updateLabelMutation.mutateAsync({
          labelId: label.id,
          mailboxId,
          name: label.name,
          visible: effectiveHiddenLabelIds.has(label.id),
        });
        await invalidateLabels();
      } catch (error) {
        toastError(error, {
          boundary: "labels-panel",
          fallback: "Could not update label.",
        });
      }
      return;
    }

    setMailboxHiddenLabelIds((current) => {
      const isShown = !effectiveHiddenLabelIds.has(label.id);
      if (isShown) {
        current.add(label.id);
      } else {
        if (visibleLabelCount >= MAX_VISIBLE_SIDEBAR_LABELS) {
          toast.error("Hide one label before showing another.");
          return current;
        }

        current.delete(label.id);
      }
      return current;
    });
  };

  const deleteLabel = async (label: MailboxLabel) => {
    if (!isNonemptyMailboxId(mailboxId)) {
      return;
    }

    try {
      await deleteLabelMutation.mutateAsync({ labelId: label.id, mailboxId });
      if (editingLabelId === label.id) {
        setEditingLabelId(null);
      }
      setMailboxHiddenLabelIds((current) => {
        current.delete(label.id);
        return current;
      });
      await invalidateLabels();
      setDeletingLabel(null);
    } catch (error) {
      toastError(error, {
        boundary: "labels-panel",
        fallback: "Could not delete label.",
      });
    }
  };

  let labelsContent: React.ReactNode;
  if (areLabelsPending) {
    labelsContent = (
      <p className="py-3 text-body text-muted-fg">Loading labels…</p>
    );
  } else if (labelsUnavailable) {
    labelsContent = (
      <p className="py-3 text-body text-destructive">Could not load labels.</p>
    );
  } else if (userLabels.length === 0) {
    labelsContent = (
      <p className="py-3 text-body text-muted-fg">No labels yet.</p>
    );
  } else {
    labelsContent = (
      <div className="flex flex-col">
        {userLabels.map((label) => {
          const isShown = !effectiveHiddenLabelIds.has(label.id);
          const isEditing = editingLabelId === label.id;
          const description = label.description ?? label.inclusionCriteria;

          return (
            <div
              className="rounded-lg px-2 py-2.5 transition-colors hover:bg-muted/40"
              key={label.id}
            >
              {isEditing ? (
                <form
                  action={() => {
                    void saveLabelEdit(label);
                  }}
                  className="flex flex-col gap-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="Label name"
                      className="min-w-0 flex-1"
                      disabled={updateLabelMutation.isPending}
                      onChange={(event) => {
                        setDraftName(event.currentTarget.value);
                      }}
                      value={draftName}
                    />
                    <IconButtonTooltip label="Save label">
                      <Button
                        aria-label="Save label"
                        disabled={
                          updateLabelMutation.isPending ||
                          draftName.trim() === ""
                        }
                        size="icon-sm"
                        type="submit"
                        variant="ghost"
                      >
                        <HugeiconsIcon aria-hidden icon={Tick02Icon} />
                      </Button>
                    </IconButtonTooltip>
                    <IconButtonTooltip label="Cancel editing">
                      <Button
                        aria-label="Cancel editing"
                        disabled={updateLabelMutation.isPending}
                        onClick={cancelEditing}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
                      </Button>
                    </IconButtonTooltip>
                  </div>
                  <Input
                    aria-label="Label description"
                    disabled={updateLabelDetailsMutation.isPending}
                    onChange={(event) => {
                      setDraftDescription(event.currentTarget.value);
                    }}
                    placeholder="A short explanation of what belongs here."
                    value={draftDescription}
                  />
                  <MailboxColorPicker
                    label="Label color"
                    onChange={setDraftColor}
                    value={draftColor}
                  />
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 rounded-full",
                      mailboxLabelDotClassNameByColor[label.color ?? "gray"]
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-fg">{label.name}</p>
                    {description === undefined || description === "" ? null : (
                      <p className="truncate text-caption text-muted-fg">
                        {description}
                      </p>
                    )}
                  </div>
                  {mailboxProvider === "managed" ? (
                    <span className="shrink-0 text-micro text-muted-fg tabular-nums">
                      {managedLabelCountById.get(label.id) ?? 0}
                    </span>
                  ) : null}
                  <IconButtonTooltip
                    label={isShown ? "Hide from sidebar" : "Show in sidebar"}
                  >
                    <Button
                      aria-label={
                        isShown ? "Hide from sidebar" : "Show in sidebar"
                      }
                      className="text-muted-fg"
                      onClick={() => {
                        void toggleSidebarVisibility(label);
                      }}
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
                    <DropdownMenuTrigger
                      aria-label={`Options for ${label.name}`}
                      className="squircle inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-control-hover hover:text-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none"
                    >
                      <HugeiconsIcon
                        aria-hidden
                        className="size-4"
                        icon={MoreVerticalIcon}
                      />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          startEditing(label);
                        }}
                      >
                        <HugeiconsIcon
                          aria-hidden
                          className="size-4"
                          icon={Edit01Icon}
                        />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => {
                          setDeletingLabel(label);
                        }}
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
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-12">
        <div className="mb-8">
          <h1 className="font-sans text-[20px]/[26px] font-normal tracking-[-0.015em] text-fg">
            Labels
          </h1>
          <p className="mt-1.5 text-body text-muted-fg">
            Create labels, choose which ones appear in your sidebar, and explain
            what belongs in each one.
          </p>
        </div>

        <form
          action={() => {
            void createLabel();
          }}
          className="mb-6 flex items-center gap-3"
        >
          <Input
            aria-label="New label name"
            className="min-w-0 flex-1"
            disabled={createLabelMutation.isPending}
            onChange={(event) => {
              setNewLabelName(event.currentTarget.value);
            }}
            placeholder="New label"
            value={newLabelName}
          />
          <MailboxColorPicker
            className="shrink-0"
            label="Label color"
            onChange={setNewLabelColor}
            value={newLabelColor}
          />
          <Button
            disabled={createLabelMutation.isPending || !newLabelName.trim()}
            type="submit"
          >
            Create
          </Button>
        </form>

        {labelsContent}
      </div>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setDeletingLabel(null);
          }
        }}
        open={!!deletingLabel}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete label</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the label from conversations and automatic rules.
              Rules left without usable settings will be disabled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogBody>
            <p className="text-body text-fg">
              Delete{" "}
              {deletingLabel?.name ? `"${deletingLabel.name}"` : "this label"}?
            </p>
          </AlertDialogBody>
          <AlertDialogFooter>
            <AlertDialogCloseButton>Cancel</AlertDialogCloseButton>
            <Button
              disabled={deleteLabelMutation.isPending || !deletingLabel}
              onClick={() => {
                if (deletingLabel) {
                  void deleteLabel(deletingLabel);
                }
              }}
              variant="destructive"
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
