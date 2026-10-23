"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
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
import { Field, FieldDescription, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Textarea } from "@quieter/ui/textarea";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";

export type PersonalMemory = RouterOutputs["ai"]["memories"]["items"][number];

export type MemoryTarget =
  | { scope: "user" }
  | { scope: "mailbox"; mailboxId: string };

export const memoryCategories = {
  activity: "Recent activity",
  identity: "About you",
  interests: "Interests",
  labeling: "Mail organization",
  preferences: "Preferences",
  relationships: "People",
  work: "Work",
  writing_style: "Writing style",
} satisfies Record<PersonalMemory["category"], string>;

const memoryCategoryOrder: PersonalMemory["category"][] = [
  "identity",
  "writing_style",
  "relationships",
  "preferences",
  "work",
  "interests",
  "activity",
  "labeling",
];

export const memoryCategoryItems = memoryCategoryOrder.map((value) => ({
  label: memoryCategories[value],
  value,
}));

export const MemoryEditor = ({
  memory,
  onClose,
  onSaved,
  target,
}: {
  memory?: PersonalMemory;
  target: MemoryTarget;
  onClose: () => void;
  onSaved: () => void;
}) => {
  const formId = useId();
  const queryClient = useQueryClient();
  const [content, setContent] = useState(memory?.content ?? "");
  const [category, setCategory] = useState<PersonalMemory["category"]>(
    memory?.category ?? "preferences"
  );
  const [correspondents, setCorrespondents] = useState(
    memory?.correspondents.join(", ") ?? ""
  );
  const save = useMutation(
    orpc.ai.saveMemory.mutationOptions({
      onError(error) {
        toastError(error, {
          boundary: "ai-settings",
          fallback: "Could not save this memory. Please try again.",
        });
      },
      async onSuccess() {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: orpc.ai.memories.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.ai.settings.key() }),
        ]);
        toast.success(memory ? "Memory updated." : "Memory added.");
        onSaved();
      },
    })
  );

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !save.isPending) {
          onClose();
        }
      }}
      open
    >
      <DialogContent className="flex max-h-[85dvh] flex-col">
        <DialogHeader>
          <DialogTitle>{memory ? "Edit memory" : "Add a memory"}</DialogTitle>
          <DialogDescription>
            Tell Quieter what matters to you, or how you like to communicate.
            Your changes also work when automatic learning is paused.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 overflow-y-auto">
          <form
            className="space-y-4"
            id={formId}
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                ...target,
                category,
                content,
                correspondents: correspondents
                  .split(",")
                  .map((address) => address.trim())
                  .filter(Boolean),
                memoryId: memory?.id,
                version: memory?.version,
              });
            }}
          >
            <Field>
              <FieldLabel htmlFor={`${formId}-content`}>Memory</FieldLabel>
              <Textarea
                disabled={save.isPending}
                id={`${formId}-content`}
                maxLength={2000}
                onChange={(event) => {
                  setContent(event.target.value);
                }}
                placeholder="I prefer short replies, with a friendly greeting."
                required
                rows={5}
                value={content}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-category`}>Category</FieldLabel>
              <Select
                disabled={save.isPending}
                items={memoryCategoryItems}
                onValueChange={(value) => {
                  const option = memoryCategoryItems.find(
                    (item) => item.value === value
                  );
                  if (option) {
                    setCategory(option.value);
                  }
                }}
                value={category}
              >
                <SelectTrigger id={`${formId}-category`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectList>
                    {memoryCategoryItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectList>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-correspondents`}>
                People, optional
              </FieldLabel>
              <Input
                disabled={save.isPending}
                id={`${formId}-correspondents`}
                maxLength={6500}
                onChange={(event) => {
                  setCorrespondents(event.target.value);
                }}
                placeholder="alex@example.com, sam@example.com"
                value={correspondents}
              />
              <FieldDescription>
                Separate email addresses with commas. Use this for a writing
                style or detail that applies to specific people.
              </FieldDescription>
            </Field>
            {save.isError ? (
              <p className="text-body text-muted-fg" role="alert">
                Your changes have not been saved. Review the details and try
                again.
              </p>
            ) : null}
          </form>
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={save.isPending}>
            Cancel
          </DialogCloseButton>
          <Button
            disabled={content.trim().length === 0 || save.isPending}
            form={formId}
            pending={save.isPending}
            pendingLabel="Saving"
            type="submit"
          >
            Save memory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
