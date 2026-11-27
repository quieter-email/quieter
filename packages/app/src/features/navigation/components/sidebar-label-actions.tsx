"use client";

import { applyMailboxSearchPatch } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type {
  MailboxRouteState,
  MailboxSearchPatch,
} from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { MailboxColorPicker } from "@quieter/app/features/message-labels/components/mailbox-color-picker";
import { serializeStructuredSearchState } from "@quieter/app/features/message-search/components/message-list-search/message-list-search-utils";
import {
  normalizeLabelSelectionKey,
  parseStructuredSearchQuery,
} from "@quieter/app/features/message-search/state/message-list-search-state";
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
import { useNavigate, useRouter } from "@tanstack/react-router";
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

export const useSidebarLabelFilterReplacement = () => {
  const router = useRouter();
  const navigate = useNavigate();
  return ({
    inScope,
    nextName,
    previousNames,
  }: {
    inScope: (search: MailboxRouteState) => boolean;
    nextName: string | null;
    previousNames: readonly string[];
  }) => {
    const previousKeys = new Set(previousNames.map(normalizeLabelSelectionKey));
    const rewrite = (search: MailboxRouteState) => {
      if (!inScope(search)) {
        return null;
      }
      const state = parseStructuredSearchQuery(search.query);
      if (
        !state.filters.some(
          (filter) =>
            filter.type === "label" &&
            previousKeys.has(normalizeLabelSelectionKey(filter.value))
        )
      ) {
        return null;
      }
      const filters = state.filters.filter(
        (filter) =>
          filter.type !== "label" ||
          (!previousKeys.has(normalizeLabelSelectionKey(filter.value)) &&
            (nextName === null ||
              normalizeLabelSelectionKey(filter.value) !==
                normalizeLabelSelectionKey(nextName)))
      );
      return applyMailboxSearchPatch(search, {
        query: serializeStructuredSearchState({
          ...state,
          filters:
            nextName === null
              ? filters
              : [...filters, { type: "label", value: nextName }],
        }),
        ...(nextName === null ? { messageId: null, threadId: null } : {}),
      });
    };
    const location = router.latestLocation;
    if (
      location.pathname !== "/" ||
      rewrite(mailboxSearchSchema.parse(location.search)) === null
    ) {
      return;
    }
    void navigate({
      replace: true,
      resetScroll: false,
      search: (previous) => {
        const search = mailboxSearchSchema.parse(previous);
        return rewrite(search) ?? search;
      },
      to: "/",
    });
  };
};

const SidebarLabelEditForm = ({
  label,
  mailboxId,
  mailboxProvider,
  onDone,
  onRenamed,
}: Omit<SidebarLabelDialogRequest, "kind"> & {
  onDone: () => void;
  onRenamed: (label: MailboxLabel) => void;
}) => {
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
          return;
        }
        let change:
          | { color: MailboxLabelColor; kind: "color" }
          | { kind: "name"; name: string }
          | { color: MailboxLabelColor; kind: "name-and-color"; name: string };
        if (!rename) {
          change = { color, kind: "color" };
        } else if (recolor) {
          change = { color, kind: "name-and-color", name: nextName };
        } else {
          change = { kind: "name", name: nextName };
        }
        // mutateAsync keeps the rename result after the dialog unmounts; onDone only runs while it is open.
        void (async () => {
          try {
            const updated = await updateLabelMutation.mutateAsync(
              { change, labelId: label.id },
              { onSuccess: onDone }
            );
            if (rename) {
              onRenamed(updated);
            }
          } catch {
            // The shared label update mutation already reports failures.
          }
        })();
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
  onRenamed,
  state,
}: {
  onOpenChange: (open: boolean) => void;
  onDeleted: (request: SidebarLabelDialogRequest) => void;
  onRenamed: (request: SidebarLabelDialogRequest, label: MailboxLabel) => void;
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
              onRenamed={(label) => {
                onRenamed(request, label);
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
