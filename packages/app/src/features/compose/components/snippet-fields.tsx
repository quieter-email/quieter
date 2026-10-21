import { Field, FieldLabel } from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import { Textarea } from "@quieter/ui/textarea";
import { useId } from "react";

export const SnippetFields = ({
  bodyText,
  name,
  onBodyTextChange,
  onNameChange,
}: {
  bodyText: string;
  name: string;
  onBodyTextChange: (value: string) => void;
  onNameChange: (value: string) => void;
}) => {
  const id = useId();

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
        <Input
          id={`${id}-name`}
          maxLength={120}
          onChange={(event) => {
            onNameChange(event.currentTarget.value);
          }}
          placeholder="Snippet name"
          required
          value={name}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${id}-text`}>Text</FieldLabel>
        <Textarea
          id={`${id}-text`}
          maxLength={100_000}
          onChange={(event) => {
            onBodyTextChange(event.currentTarget.value);
          }}
          placeholder="Write text to reuse in a message"
          required
          rows={3}
          value={bodyText}
          variant="composer"
        />
      </Field>
    </>
  );
};
