"use client";

import { Loading03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type {
  MessageLabelsDialogTarget,
  MessageLabelsDialogUpdate,
} from "~/features/message-labels/domain/message-label-updates";
import { getMessageLabelUpdates } from "~/features/message-labels/domain/message-label-updates";
import { getUserLabels } from "~/features/message-search/state/message-list-search-state";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";

export const MessageLabelsDialog = ({
  isPending,
  mailboxId,
  onApply,
  onOpenChange,
  open,
  targets,
}: {
  isPending: boolean;
  mailboxId: string;
  onApply: (updates: MessageLabelsDialogUpdate[]) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  targets: readonly MessageLabelsDialogTarget[];
}) => {
  const {
    data: labels,
    error: labelsError,
    isError,
    isPending: areLabelsPending,
  } = useQuery(labelsQueryOptions(mailboxId, open));
  const userLabels = getUserLabels(labels ?? []);
  const labelsUnavailable = isError && !labels;
  const [draftLabels, setDraftLabels] = useState<Record<string, boolean>>({});
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const isBusy = isPending || isApplying;

  const setOpen = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    setDraftLabels({});
    setIsApplying(false);
    setApplyError(null);
  };

  const applyLabels = async () => {
    if (isBusy) return;

    const updates = getMessageLabelUpdates(targets, draftLabels);

    if (updates.length === 0) {
      setOpen(false);
      return;
    }

    setIsApplying(true);
    setApplyError(null);
    try {
      await onApply(updates);
      setOpen(false);
    } catch (error) {
      setApplyError(
        error instanceof Error && error.message ? error.message : "Could not update labels.",
      );
      setIsApplying(false);
    }
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify labels</DialogTitle>
        </DialogHeader>

        <DialogBody className="max-h-[50vh] space-y-3 overflow-y-auto">
          {areLabelsPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />
              <span>Loading labels…</span>
            </div>
          ) : labelsUnavailable ? (
            <p className="text-sm text-destructive">
              {labelsError?.message ?? "Could not load labels."}
            </p>
          ) : userLabels.length > 0 ? (
            <div className="space-y-2">
              {userLabels.map((label) => {
                const selectedCount = targets.reduce(
                  (count, target) => count + Number(target.labelIds.includes(label.id)),
                  0,
                );
                const checked = draftLabels[label.id] ?? selectedCount === targets.length;
                const indeterminate =
                  draftLabels[label.id] === undefined &&
                  selectedCount > 0 &&
                  selectedCount < targets.length;

                return (
                  <label className="flex items-center gap-2 text-sm text-foreground" key={label.id}>
                    <Checkbox
                      aria-label={label.name}
                      checked={checked}
                      disabled={isBusy}
                      indeterminate={indeterminate}
                      onCheckedChange={(nextChecked) =>
                        setDraftLabels((current) => ({
                          ...current,
                          [label.id]: nextChecked,
                        }))
                      }
                    >
                      <CheckboxIndicator />
                    </Checkbox>
                    <span>{label.name}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No custom labels.</p>
          )}

          {applyError && <p className="text-sm text-destructive">{applyError}</p>}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton>Cancel</DialogCloseButton>
          <Button
            disabled={
              Object.keys(draftLabels).length === 0 ||
              areLabelsPending ||
              labelsUnavailable ||
              isBusy
            }
            onClick={() => void applyLabels()}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
