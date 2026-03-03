import type { ComponentProps } from "solid-js";
import * as SwitchPrimitive from "@kobalte/core/switch";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root>;

export const Switch = (props: SwitchProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SwitchPrimitive.Root class={cn("grid gap-1.5", local.class)} {...others} />;
};

export type SwitchLabelProps = ComponentProps<typeof SwitchPrimitive.Label>;

export const SwitchLabel = (props: SwitchLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type SwitchInputProps = ComponentProps<typeof SwitchPrimitive.Input>;

export const SwitchInput = (props: SwitchInputProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SwitchPrimitive.Input class={cn("sr-only", local.class)} {...others} />;
};

export type SwitchControlProps = ComponentProps<typeof SwitchPrimitive.Control>;

export const SwitchControl = (props: SwitchControlProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.Control
      class={cn(
        "inline-flex h-6 w-11 items-center border border-input bg-muted px-0.5 text-primary shadow-sm transition-colors data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary/20",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type SwitchThumbProps = ComponentProps<typeof SwitchPrimitive.Thumb>;

export const SwitchThumb = (props: SwitchThumbProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.Thumb
      class={cn(
        "block size-4 border border-current bg-background transition-transform data-[checked]:translate-x-5 data-[unchecked]:translate-x-0",
        local.class,
      )}
      {...others}
    />
  );
};

export type SwitchDescriptionProps = ComponentProps<typeof SwitchPrimitive.Description>;

export const SwitchDescription = (props: SwitchDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type SwitchErrorMessageProps = ComponentProps<typeof SwitchPrimitive.ErrorMessage>;

export const SwitchErrorMessage = (props: SwitchErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SwitchPrimitive.ErrorMessage class={cn("text-xs text-destructive", local.class)} {...others} />
  );
};
