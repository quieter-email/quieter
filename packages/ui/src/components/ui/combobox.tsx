import type { ComponentProps } from "solid-js";
import * as ComboboxPrimitive from "@kobalte/core/combobox";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type ComboboxProps = ComponentProps<typeof ComboboxPrimitive.Root>;

export const Combobox = (props: ComboboxProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ComboboxPrimitive.Root class={cn("grid w-full gap-1.5", local.class)} {...others} />;
};

export type ComboboxLabelProps = ComponentProps<typeof ComboboxPrimitive.Label>;

export const ComboboxLabel = (props: ComboboxLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxControlProps = ComponentProps<typeof ComboboxPrimitive.Control>;

export const ComboboxControl = (props: ComboboxControlProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Control
      class={cn(
        "flex h-10 w-full items-center border border-input bg-background text-foreground shadow-sm transition-all focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30 focus-within:ring-offset-2 focus-within:ring-offset-background hover:border-foreground/20 hover:shadow-md",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxInputProps = ComponentProps<typeof ComboboxPrimitive.Input>;

export const ComboboxInput = (props: ComboboxInputProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Input
      class={cn(
        "h-full flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxTriggerProps = ComponentProps<typeof ComboboxPrimitive.Trigger>;

export const ComboboxTrigger = (props: ComboboxTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Trigger
      class={cn(
        "inline-flex size-10 items-center justify-center border-l border-input bg-background text-muted-foreground transition-colors hover:text-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxIconProps = ComponentProps<typeof ComboboxPrimitive.Icon>;

export const ComboboxIcon = (props: ComboboxIconProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <ComboboxPrimitive.Icon
      class={cn("inline-flex items-center justify-center", local.class)}
      {...others}
    >
      {local.children ?? <span class="block size-2.5 rotate-45 border-r border-b border-current" />}
    </ComboboxPrimitive.Icon>
  );
};

export type ComboboxContentProps = ComponentProps<typeof ComboboxPrimitive.Content>;

export const ComboboxContent = (props: ComboboxContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Content
      class={cn(
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxPortalProps = ComponentProps<typeof ComboboxPrimitive.Portal>;

export const ComboboxPortal = (props: ComboboxPortalProps) => (
  <ComboboxPrimitive.Portal {...props} />
);

export type ComboboxListboxProps = ComponentProps<typeof ComboboxPrimitive.Listbox>;

export const ComboboxListbox = (props: ComboboxListboxProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Listbox class={cn("max-h-64 overflow-auto p-1", local.class)} {...others} />
  );
};

export type ComboboxItemProps = ComponentProps<typeof ComboboxPrimitive.Item>;

export const ComboboxItem = (props: ComboboxItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Item
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type ComboboxItemIndicatorProps = ComponentProps<typeof ComboboxPrimitive.ItemIndicator>;

export const ComboboxItemIndicator = (props: ComboboxItemIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <ComboboxPrimitive.ItemIndicator
      class={cn("absolute left-2 inline-flex size-3.5 items-center justify-center", local.class)}
      {...others}
    >
      {local.children ?? (
        <span class="-mt-px block h-2 w-1.5 rotate-45 border-r-2 border-b-2 border-current" />
      )}
    </ComboboxPrimitive.ItemIndicator>
  );
};

export type ComboboxItemLabelProps = ComponentProps<typeof ComboboxPrimitive.ItemLabel>;

export const ComboboxItemLabel = (props: ComboboxItemLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ComboboxPrimitive.ItemLabel class={cn("text-sm", local.class)} {...others} />;
};

export type ComboboxItemDescriptionProps = ComponentProps<typeof ComboboxPrimitive.ItemDescription>;

export const ComboboxItemDescription = (props: ComboboxItemDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.ItemDescription
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type ComboboxSectionProps = ComponentProps<typeof ComboboxPrimitive.Section>;

export const ComboboxSection = (props: ComboboxSectionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ComboboxPrimitive.Section class={cn("p-1", local.class)} {...others} />;
};

export type ComboboxHiddenSelectProps = ComponentProps<typeof ComboboxPrimitive.HiddenSelect>;

export const ComboboxHiddenSelect = (props: ComboboxHiddenSelectProps) => (
  <ComboboxPrimitive.HiddenSelect {...props} />
);

export type ComboboxDescriptionProps = ComponentProps<typeof ComboboxPrimitive.Description>;

export const ComboboxDescription = (props: ComboboxDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type ComboboxErrorMessageProps = ComponentProps<typeof ComboboxPrimitive.ErrorMessage>;

export const ComboboxErrorMessage = (props: ComboboxErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ComboboxPrimitive.ErrorMessage
      class={cn("text-xs text-destructive", local.class)}
      {...others}
    />
  );
};
