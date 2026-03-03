import type { ComponentProps } from "solid-js";
import * as CheckboxPrimitive from "@kobalte/core/checkbox";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>;

export const Checkbox = (props: CheckboxProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <CheckboxPrimitive.Root class={cn("grid gap-1.5", local.class)} {...others} />;
};

export type CheckboxLabelProps = ComponentProps<typeof CheckboxPrimitive.Label>;

export const CheckboxLabel = (props: CheckboxLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <CheckboxPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type CheckboxInputProps = ComponentProps<typeof CheckboxPrimitive.Input>;

export const CheckboxInput = (props: CheckboxInputProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <CheckboxPrimitive.Input class={cn("sr-only", local.class)} {...others} />;
};

export type CheckboxControlProps = ComponentProps<typeof CheckboxPrimitive.Control>;

export const CheckboxControl = (props: CheckboxControlProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <CheckboxPrimitive.Control
      class={cn(
        "inline-flex size-4 items-center justify-center border border-input bg-background text-primary shadow-sm transition-colors",
        "data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
        "data-[indeterminate]:border-primary data-[indeterminate]:bg-primary data-[indeterminate]:text-primary-foreground",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type CheckboxIndicatorProps = ComponentProps<typeof CheckboxPrimitive.Indicator>;

export const CheckboxIndicator = (props: CheckboxIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <CheckboxPrimitive.Indicator class={cn("grid place-items-center", local.class)} {...others}>
      {local.children ?? (
        <span class="-mt-px block h-2 w-1.5 rotate-45 border-r-2 border-b-2 border-current" />
      )}
    </CheckboxPrimitive.Indicator>
  );
};

export type CheckboxDescriptionProps = ComponentProps<typeof CheckboxPrimitive.Description>;

export const CheckboxDescription = (props: CheckboxDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <CheckboxPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type CheckboxErrorMessageProps = ComponentProps<typeof CheckboxPrimitive.ErrorMessage>;

export const CheckboxErrorMessage = (props: CheckboxErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <CheckboxPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
