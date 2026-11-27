"use client";

import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
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

import type { LabelGroup } from "../domain/label-group-tree";
import { LabelGroupSelect } from "./label-group-select";
import type { LabelGroupOption } from "./label-group-select";

export type LabelGroupDraft = Omit<LabelGroup, "id">;

export const LabelGroupDialog = ({
  canManage,
  defaultColor,
  group,
  groupOptions,
  initialParentId,
  isPending,
  onCancel,
  onSubmit,
}: {
  canManage: boolean;
  defaultColor: MailboxLabelColor;
  group: LabelGroup | null;
  groupOptions: readonly LabelGroupOption[];
  initialParentId: string | null;
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (draft: LabelGroupDraft) => void;
}) => {
  const id = useId();
  const [name, setName] = useState(group?.name ?? "");
  const [color, setColor] = useState(group?.color ?? defaultColor);
  const [parentId, setParentId] = useState(group?.parentId ?? initialParentId);

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
                options={groupOptions}
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
