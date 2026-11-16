import { resolveSnippetVariables } from "@quieter/mail/compose/schema";
import type { SnippetContextValues } from "@quieter/mail/compose/schema";
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
import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Text } from "@quieter/ui/text";
import { useId, useRef, useState } from "react";

export const InsertSnippetDialog = ({
  source,
  context,
  editorElement,
  onCancel,
  onInsert,
}: {
  source: string;
  context: SnippetContextValues;
  editorElement: HTMLElement;
  onCancel: () => void;
  onInsert: (text: string) => string | null;
}) => {
  const id = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const { fields } = resolveSnippetVariables(source, context);
  const resolved = resolveSnippetVariables(source, context, values);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent initialFocus={firstInput} finalFocus={() => editorElement}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(onInsert(resolved.text));
          }}
        >
          <DialogHeader>
            <DialogTitle>Fill snippet fields</DialogTitle>
            <DialogDescription>
              Tab between fields. Blank fields stay marked in your draft and
              must be completed before sending. Your saved snippet stays
              unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogBody spacing="4">
            {fields.map((field, index) => (
              <Field key={field}>
                <FieldLabel className="break-all" htmlFor={`${id}-${field}`}>
                  {field}
                </FieldLabel>
                <Input
                  id={`${id}-${field}`}
                  ref={index === 0 ? firstInput : undefined}
                  value={values[field] ?? ""}
                  onChange={(event) => {
                    const { value } = event.currentTarget;
                    setValues((current) => ({ ...current, [field]: value }));
                  }}
                />
              </Field>
            ))}
            <div className="space-y-2">
              <Text weight="medium">Preview</Text>
              <Text className="break-words whitespace-pre-wrap">
                {resolved.text}
              </Text>
            </div>
            {error ? (
              <Text role="alert" tone="destructive">
                {error}
              </Text>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button type="submit">Insert snippet</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
