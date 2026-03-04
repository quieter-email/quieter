import type { ComponentProps } from "solid-js";
import * as ContextMenuPrimitive from "@kobalte/core/context-menu";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type ContextMenuProps = ComponentProps<typeof ContextMenuPrimitive.Root>;

export const ContextMenu = (props: ContextMenuProps) => <ContextMenuPrimitive.Root {...props} />;

export type ContextMenuTriggerProps = ComponentProps<typeof ContextMenuPrimitive.Trigger>;

export const ContextMenuTrigger = (props: ContextMenuTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuPortalProps = ComponentProps<typeof ContextMenuPrimitive.Portal>;

export const ContextMenuPortal = (props: ContextMenuPortalProps) => (
  <ContextMenuPrimitive.Portal {...props} />
);

export type ContextMenuContentProps = ComponentProps<typeof ContextMenuPrimitive.Content>;

export const ContextMenuContent = (props: ContextMenuContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.Content
      class={cn(
        "data-expanded:animate-in data-expanded:fade-in-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground data-closed:pointer-events-none data-closed:opacity-0",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuArrowProps = ComponentProps<typeof ContextMenuPrimitive.Arrow>;

export const ContextMenuArrow = (props: ContextMenuArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />
  );
};

export type ContextMenuGroupProps = ComponentProps<typeof ContextMenuPrimitive.Group>;

export const ContextMenuGroup = (props: ContextMenuGroupProps) => (
  <ContextMenuPrimitive.Group {...props} />
);

export type ContextMenuGroupLabelProps = ComponentProps<typeof ContextMenuPrimitive.GroupLabel>;

export const ContextMenuGroupLabel = (props: ContextMenuGroupLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.GroupLabel
      class={cn(
        "px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuItemProps = ComponentProps<typeof ContextMenuPrimitive.Item>;

export const ContextMenuItem = (props: ContextMenuItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.Item
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:border-border data-highlighted:bg-muted/60",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuItemLabelProps = ComponentProps<typeof ContextMenuPrimitive.ItemLabel>;

export const ContextMenuItemLabel = (props: ContextMenuItemLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ContextMenuPrimitive.ItemLabel class={cn("text-sm", local.class)} {...others} />;
};

export type ContextMenuItemDescriptionProps = ComponentProps<
  typeof ContextMenuPrimitive.ItemDescription
>;

export const ContextMenuItemDescription = (props: ContextMenuItemDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.ItemDescription
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type ContextMenuItemIndicatorProps = ComponentProps<
  typeof ContextMenuPrimitive.ItemIndicator
>;

export const ContextMenuItemIndicator = (props: ContextMenuItemIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <ContextMenuPrimitive.ItemIndicator
      class={cn("absolute left-2 inline-flex size-3.5 items-center justify-center", local.class)}
      {...others}
    >
      {local.children ?? (
        <span class="-mt-px block h-2 w-1.5 rotate-45 border-r-2 border-b-2 border-current" />
      )}
    </ContextMenuPrimitive.ItemIndicator>
  );
};

export type ContextMenuCheckboxItemProps = ComponentProps<typeof ContextMenuPrimitive.CheckboxItem>;

export const ContextMenuCheckboxItem = (props: ContextMenuCheckboxItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.CheckboxItem
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:border-border data-highlighted:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuRadioGroupProps = ComponentProps<typeof ContextMenuPrimitive.RadioGroup>;

export const ContextMenuRadioGroup = (props: ContextMenuRadioGroupProps) => (
  <ContextMenuPrimitive.RadioGroup {...props} />
);

export type ContextMenuRadioItemProps = ComponentProps<typeof ContextMenuPrimitive.RadioItem>;

export const ContextMenuRadioItem = (props: ContextMenuRadioItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.RadioItem
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:border-border data-highlighted:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuSeparatorProps = ComponentProps<typeof ContextMenuPrimitive.Separator>;

export const ContextMenuSeparator = (props: ContextMenuSeparatorProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <ContextMenuPrimitive.Separator class={cn("my-1 bg-border", local.class)} {...others} />;
};

export type ContextMenuSubProps = ComponentProps<typeof ContextMenuPrimitive.Sub>;

export const ContextMenuSub = (props: ContextMenuSubProps) => (
  <ContextMenuPrimitive.Sub {...props} />
);

export type ContextMenuSubTriggerProps = ComponentProps<typeof ContextMenuPrimitive.SubTrigger>;

export const ContextMenuSubTrigger = (props: ContextMenuSubTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.SubTrigger
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:border-border data-highlighted:bg-muted/60",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuSubContentProps = ComponentProps<typeof ContextMenuPrimitive.SubContent>;

export const ContextMenuSubContent = (props: ContextMenuSubContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.SubContent
      class={cn(
        "data-expanded:animate-in data-expanded:fade-in-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground data-closed:pointer-events-none data-closed:opacity-0",
        local.class,
      )}
      {...others}
    />
  );
};

export type ContextMenuIconProps = ComponentProps<typeof ContextMenuPrimitive.Icon>;

export const ContextMenuIcon = (props: ContextMenuIconProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <ContextMenuPrimitive.Icon
      class={cn("ml-auto text-muted-foreground", local.class)}
      {...others}
    />
  );
};
