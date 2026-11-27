"use client";

import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { MailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import { mailboxSearchSchema } from "@quieter/app/route-search";
import type {
  MailboxLabel,
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
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";

import { DeleteMailboxLabelDialog } from "../../message-labels/components/delete-mailbox-label-dialog";
import { getLabelUpdates } from "../../message-labels/components/label-update-mutation";

export type SidebarLabelDialogRequest = {
  kind: "delete" | "edit";
  label: MailboxLabel;
  mailboxId: string;
  mailboxProvider: MailboxLabel["provider"];
};

export type SidebarLabelDialogState = {
  open: boolean;
  request: SidebarLabelDialogRequest;
};

export const useSidebarSearchNavigation = () => {
  const navigate = useNavigate();
  return (patch: MailboxSearchPatch) => {
    void navigate({
      replace: true,
      resetScroll: false,
      search: (previous) =>
        applyMailboxSearchPatch(mailboxSearchSchema.parse(previous), patch),
      to: "/",
    });
  };
};

const SidebarLabelEditForm = ({
  label,
  mailboxId,
  mailboxProvider,
  onDone,
}: Omit<SidebarLabelDialogRequest, "kind"> & { onDone: () => void }) => {
  const queryClient = useQueryClient();
  const id = useId();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<MailboxLabelColor>(label.color ?? "gray");
  const updateLabelMutation = useMutation(
    getLabelUpdates({ mailboxId, mailboxProvider, queryClient }).options
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const nextName = name.trim();
        if (nextName === "") {
          toast.error("Enter a label name.");
          return;
        }
        const rename = nextName !== label.name;
        const recolor = color !== (label.color ?? "gray");
        if (!rename && !recolor) {
          onDone();
        } else if (rename && recolor) {
          updateLabelMutation.mutate(
            {
              change: { color, kind: "name-and-color", name: nextName },
              labelId: label.id,
            },
            { onSuccess: onDone }
          );
        } else {
          updateLabelMutation.mutate(
            {
              change: rename
                ? { kind: "name", name: nextName }
                : { color, kind: "color" },
              labelId: label.id,
            },
            { onSuccess: onDone }
          );
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>Edit label</DialogTitle>
      </DialogHeader>
      <DialogBody spacing="3">
        <Field>
          <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
          <Input
            id={`${id}-name`}
            maxLength={225}
            onChange={(event) => {
              setName(event.currentTarget.value);
            }}
            required
            value={name}
          />
        </Field>
        <Field>
          <Text as="p" weight="medium">
            Color
          </Text>
          <MailboxColorPicker
            label="Label color"
            onChange={setColor}
            value={color}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <DialogCloseButton
          disabled={updateLabelMutation.isPending}
          variant="secondary"
        >
          Cancel
        </DialogCloseButton>
        <Button
          disabled={name.trim() === ""}
          pending={updateLabelMutation.isPending}
          pendingLabel="Saving…"
          type="submit"
        >
          Save
        </Button>
      </DialogFooter>
    </form>
  );
};

export const SidebarLabelDialogs = ({
  onDeleted,
  onOpenChange,
  state,
}: {
  onOpenChange: (open: boolean) => void;
  onDeleted: (request: SidebarLabelDialogRequest) => void;
  state: SidebarLabelDialogState | null;
}) => {
  const request = state?.request ?? null;
  return (
    <>
      <Dialog
        onOpenChange={onOpenChange}
        open={state?.open === true && request?.kind === "edit"}
      >
        <DialogContent>
          {request?.kind === "edit" ? (
            <SidebarLabelEditForm
              key={`${request.mailboxId}:${request.label.id}`}
              label={request.label}
              mailboxId={request.mailboxId}
              mailboxProvider={request.mailboxProvider}
              onDone={() => {
                onOpenChange(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      {request?.kind === "delete" && (
        <DeleteMailboxLabelDialog
          label={request.label}
          mailboxId={request.mailboxId}
          mailboxProvider={request.mailboxProvider}
          onDeleted={() => {
            onDeleted(request);
          }}
          onOpenChange={onOpenChange}
          open={state?.open === true}
        />
      )}
    </>
  );
};
