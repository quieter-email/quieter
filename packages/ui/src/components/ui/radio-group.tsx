import type { ComponentProps } from "solid-js";
import * as RadioGroupPrimitive from "@kobalte/core/radio-group";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type RadioGroupProps = ComponentProps<typeof RadioGroupPrimitive.Root>;

export const RadioGroup = (props: RadioGroupProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <RadioGroupPrimitive.Root class={cn("grid w-full gap-2", local.class)} {...others} />;
};

export type RadioGroupLabelProps = ComponentProps<typeof RadioGroupPrimitive.Label>;

export const RadioGroupLabel = (props: RadioGroupLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type RadioGroupItemProps = ComponentProps<typeof RadioGroupPrimitive.Item>;

export const RadioGroupItem = (props: RadioGroupItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <RadioGroupPrimitive.Item class={cn("flex items-start gap-2", local.class)} {...others} />;
};

export type RadioGroupItemInputProps = ComponentProps<typeof RadioGroupPrimitive.ItemInput>;

export const RadioGroupItemInput = (props: RadioGroupItemInputProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <RadioGroupPrimitive.ItemInput class={cn("sr-only", local.class)} {...others} />;
};

export type RadioGroupItemControlProps = ComponentProps<typeof RadioGroupPrimitive.ItemControl>;

export const RadioGroupItemControl = (props: RadioGroupItemControlProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.ItemControl
      class={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background text-primary shadow-sm transition-colors data-[checked]:border-primary",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

export type RadioGroupItemIndicatorProps = ComponentProps<typeof RadioGroupPrimitive.ItemIndicator>;

export const RadioGroupItemIndicator = (props: RadioGroupItemIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <RadioGroupPrimitive.ItemIndicator
      class={cn("grid place-items-center", local.class)}
      {...others}
    >
      {local.children ?? <span class="size-2 rounded-full bg-current" />}
    </RadioGroupPrimitive.ItemIndicator>
  );
};

export type RadioGroupItemLabelProps = ComponentProps<typeof RadioGroupPrimitive.ItemLabel>;

export const RadioGroupItemLabel = (props: RadioGroupItemLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.ItemLabel
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type RadioGroupItemDescriptionProps = ComponentProps<
  typeof RadioGroupPrimitive.ItemDescription
>;

export const RadioGroupItemDescription = (props: RadioGroupItemDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.ItemDescription
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type RadioGroupDescriptionProps = ComponentProps<typeof RadioGroupPrimitive.Description>;

export const RadioGroupDescription = (props: RadioGroupDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type RadioGroupErrorMessageProps = ComponentProps<typeof RadioGroupPrimitive.ErrorMessage>;

export const RadioGroupErrorMessage = (props: RadioGroupErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <RadioGroupPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
