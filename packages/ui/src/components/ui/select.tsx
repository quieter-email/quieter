import type { ComponentProps } from "solid-js";
import * as SelectPrimitive from "@kobalte/core/select";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type SelectProps = ComponentProps<typeof SelectPrimitive.Root>;

export const Select = (props: SelectProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectPrimitive.Root class={cn("grid w-full gap-1.5", local.class)} {...others} />;
};

export type SelectLabelProps = ComponentProps<typeof SelectPrimitive.Label>;

export const SelectLabel = (props: SelectLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Label
      class={cn(
        "text-sm leading-none font-medium text-foreground data-disabled:opacity-60",
        local.class,
      )}
      {...others}
    />
  );
};

export type SelectTriggerProps = ComponentProps<typeof SelectPrimitive.Trigger>;

export const SelectTrigger = (props: SelectTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Trigger
      class={cn(
        "inline-flex h-10 w-full items-center justify-between border border-input bg-background px-3 text-left text-sm text-foreground shadow-sm transition-all hover:border-foreground/20 hover:shadow-md data-disabled:cursor-not-allowed data-disabled:opacity-50 data-[placeholder-shown]:text-muted-foreground",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type SelectValueProps = ComponentProps<typeof SelectPrimitive.Value>;

export const SelectValue = (props: SelectValueProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectPrimitive.Value class={cn("truncate", local.class)} {...others} />;
};

export type SelectIconProps = ComponentProps<typeof SelectPrimitive.Icon>;

export const SelectIcon = (props: SelectIconProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <SelectPrimitive.Icon
      class={cn("ml-2 inline-flex shrink-0 items-center", local.class)}
      {...others}
    >
      {local.children ?? <span class="block size-2.5 rotate-45 border-r border-b border-current" />}
    </SelectPrimitive.Icon>
  );
};

export type SelectHiddenSelectProps = ComponentProps<typeof SelectPrimitive.HiddenSelect>;

export const SelectHiddenSelect = (props: SelectHiddenSelectProps) => (
  <SelectPrimitive.HiddenSelect {...props} />
);

export type SelectPortalProps = ComponentProps<typeof SelectPrimitive.Portal>;

export const SelectPortal = (props: SelectPortalProps) => <SelectPrimitive.Portal {...props} />;

export type SelectContentProps = ComponentProps<typeof SelectPrimitive.Content>;

export const SelectContent = (props: SelectContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Content
      class={cn(
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

export type SelectArrowProps = ComponentProps<typeof SelectPrimitive.Arrow>;

export const SelectArrow = (props: SelectArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />;
};

export type SelectListboxProps = ComponentProps<typeof SelectPrimitive.Listbox>;

export const SelectListbox = (props: SelectListboxProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Listbox class={cn("max-h-64 overflow-auto p-1", local.class)} {...others} />
  );
};

export type SelectItemProps = ComponentProps<typeof SelectPrimitive.Item>;

export const SelectItem = (props: SelectItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Item
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type SelectItemIndicatorProps = ComponentProps<typeof SelectPrimitive.ItemIndicator>;

export const SelectItemIndicator = (props: SelectItemIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <SelectPrimitive.ItemIndicator
      class={cn("absolute left-2 inline-flex size-3.5 items-center justify-center", local.class)}
      {...others}
    >
      {local.children ?? (
        <span class="-mt-px block h-2 w-1.5 rotate-45 border-r-2 border-b-2 border-current" />
      )}
    </SelectPrimitive.ItemIndicator>
  );
};

export type SelectItemLabelProps = ComponentProps<typeof SelectPrimitive.ItemLabel>;

export const SelectItemLabel = (props: SelectItemLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectPrimitive.ItemLabel class={cn("text-sm", local.class)} {...others} />;
};

export type SelectItemDescriptionProps = ComponentProps<typeof SelectPrimitive.ItemDescription>;

export const SelectItemDescription = (props: SelectItemDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.ItemDescription
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type SelectSectionProps = ComponentProps<typeof SelectPrimitive.Section>;

export const SelectSection = (props: SelectSectionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <SelectPrimitive.Section class={cn("p-1", local.class)} {...others} />;
};

export type SelectDescriptionProps = ComponentProps<typeof SelectPrimitive.Description>;

export const SelectDescription = (props: SelectDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.Description
      class={cn("text-xs text-muted-foreground data-disabled:opacity-60", local.class)}
      {...others}
    />
  );
};

export type SelectErrorMessageProps = ComponentProps<typeof SelectPrimitive.ErrorMessage>;

export const SelectErrorMessage = (props: SelectErrorMessageProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <SelectPrimitive.ErrorMessage class={cn("text-xs text-destructive", local.class)} {...others} />
  );
};
