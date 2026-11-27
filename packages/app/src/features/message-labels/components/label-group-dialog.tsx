"use client";

import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import type {
  LabelOrganization,
  MailboxLabelColor,
} from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";
import { useId, useState } from "react";

import { LabelGroupSelect } from "./label-group-select";
import type { LabelGroupOption } from "./label-group-select";

export type LabelGroup = LabelOrganization["groups"][number];

export type LabelGroupDraft = Omit<LabelGroup, "id">;

export const LabelGroupDialog = ({
  canManage,
  group,
  groupOptions,
  groups,
  initialParentId,
  isPending,
  onCancel,
  onSubmit,
}: {
  canManage: boolean;
  group: LabelGroup | null;
  groupOptions: readonly LabelGroupOption[];
  groups: readonly LabelGroup[];
  initialParentId: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (draft: LabelGroupDraft) => void;
}) => {
  const id = useId();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState<MailboxLabelColor>(group?.color ?? "gray");
  const [parentId, setParentId] = useState(group?.parentId ?? initialParentId);

  const excludedGroupIds = new Set<string>();
  if (group) {
    excludedGroupIds.add(group.id);
    let added = true;
    while (added) {
      added = false;
      for (const candidate of groups) {
        if (
          candidate.parentId !== null &&
          excludedGroupIds.has(candidate.parentId) &&
          !excludedGroupIds.has(candidate.id)
        ) {
          excludedGroupIds.add(candidate.id);
          added = true;
        }
      }
    }
  }
  const disabled = !canManage || isPending;
  const trimmedName = name.trim();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
      open
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!disabled && trimmedName !== "") {
              onSubmit({ color, name: trimmedName, parentId });
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{group ? "Edit group" : "New group"}</DialogTitle>
          </DialogHeader>
          <DialogBody spacing="3">
            <Field>
              <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
              <Input
                disabled={disabled}
                id={`${id}-name`}
                maxLength={100}
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                placeholder="e.g. Clients"
                required
                value={name}
              />
            </Field>
            <Field>
              <Text as="p" weight="medium">
                Color
              </Text>
              <MailboxColorPicker
                disabled={disabled}
                label="Group color"
                onChange={setColor}
                value={color}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-parent`}>Inside</FieldLabel>
              <LabelGroupSelect
                disabled={disabled}
                id={`${id}-parent`}
                noneLabel="Top level"
                onChange={setParentId}
                options={groupOptions.filter(
                  (option) => !excludedGroupIds.has(option.id)
                )}
                value={parentId}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton disabled={isPending} variant="secondary">
              Cancel
            </DialogCloseButton>
            <Button
              disabled={disabled || trimmedName === ""}
              pending={isPending}
              pendingLabel={group ? "Saving…" : "Creating…"}
              type="submit"
            >
              {group ? "Save group" : "Create group"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
