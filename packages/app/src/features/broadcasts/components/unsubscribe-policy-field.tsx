import { unsubscribePolicySchema } from "@quieter/mail/campaign-unsubscribe";
import type { UnsubscribePolicy } from "@quieter/mail/campaign-unsubscribe";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@quieter/ui/field";
import { Input } from "@quieter/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectList,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { useId } from "react";

type UnsubscribePolicyFieldProps = { disabled?: boolean } & (
  | {
      scope: "audience";
      value: UnsubscribePolicy;
      onChange: (value: UnsubscribePolicy) => void;
    }
  | {
      scope: "campaign";
      audiencePolicy?: UnsubscribePolicy;
      value: UnsubscribePolicy | null;
      onChange: (value: UnsubscribePolicy | null) => void;
    }
);

export const UnsubscribePolicyField = (props: UnsubscribePolicyFieldProps) => {
  const id = useId();
  const validation = unsubscribePolicySchema.safeParse(props.value);
  const effective =
    props.value ??
    (props.scope === "campaign" ? props.audiencePolicy : undefined);
  let description =
    props.value?.kind === "custom"
      ? "Your endpoint forwards unsubscribes to Quieter to update this audience."
      : "Quieter handles unsubscribes and updates this audience.";
  if (props.scope === "campaign") {
    if (props.value === null) {
      if (effective) {
        const destination =
          effective.kind === "managed"
            ? "managed by Quieter"
            : `custom endpoint at ${effective.urlTemplate}`;
        description = `Audience default, ${destination}. Changes to the audience default apply until sending starts.`;
      } else {
        description =
          "Uses the audience's current default. Choose an audience to see its destination.";
      }
    } else {
      description =
        props.value.kind === "managed"
          ? "Campaign override. Quieter handles unsubscribes for this campaign."
          : "Campaign override. This campaign uses your custom endpoint.";
    }
  }
  const items = [
    ...(props.scope === "campaign"
      ? [{ label: "Use audience default", value: "inherit" }]
      : []),
    { label: "Managed by Quieter", value: "managed" },
    { label: "Custom endpoint", value: "custom" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor={`${id}-policy`}>Unsubscribe</FieldLabel>
        <Select
          disabled={props.disabled}
          items={items}
          onValueChange={(value) => {
            if (value === "inherit" && props.scope === "campaign") {
              props.onChange(null);
            } else if (value === "managed") {
              props.onChange({ kind: "managed" });
            } else if (value === "custom") {
              props.onChange({ kind: "custom", urlTemplate: "" });
            }
          }}
          value={props.value?.kind ?? "inherit"}
        >
          <SelectTrigger id={`${id}-policy`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectList>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectList>
          </SelectContent>
        </Select>
        <FieldDescription className="break-words">
          {description}
        </FieldDescription>
      </Field>
      {props.value?.kind === "custom" ? (
        <Field invalid={!validation.success}>
          <FieldLabel htmlFor={`${id}-url`}>
            Unsubscribe URL template
          </FieldLabel>
          <Input
            aria-invalid={!validation.success}
            autoComplete="off"
            disabled={props.disabled}
            id={`${id}-url`}
            onChange={(event) => {
              props.onChange({
                kind: "custom",
                urlTemplate: event.target.value,
              });
            }}
            placeholder="https://example.com/unsubscribe/{{unsubscribe_token}}"
            required
            spellCheck={false}
            value={props.value.urlTemplate}
          />
          <FieldDescription>
            Use HTTPS and exactly one {"{{unsubscribe_token}}"} as a whole path
            segment or query value. Your endpoint must accept one-click POSTs
            without login or redirects and forward them to Quieter to update
            this audience. We check the format without probing your endpoint.
          </FieldDescription>
          {validation.success ? null : (
            <FieldError match>{validation.error.issues[0]?.message}</FieldError>
          )}
        </Field>
      ) : null}
    </div>
  );
};
