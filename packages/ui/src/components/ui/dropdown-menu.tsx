import type { ComponentProps } from "solid-js";
import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type DropdownMenuProps = ComponentProps<typeof DropdownMenuPrimitive.Root>;

export const DropdownMenu = (props: DropdownMenuProps) => <DropdownMenuPrimitive.Root {...props} />;

export type DropdownMenuTriggerProps = ComponentProps<typeof DropdownMenuPrimitive.Trigger>;

export const DropdownMenuTrigger = (props: DropdownMenuTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuPortalProps = ComponentProps<typeof DropdownMenuPrimitive.Portal>;

export const DropdownMenuPortal = (props: DropdownMenuPortalProps) => (
  <DropdownMenuPrimitive.Portal {...props} />
);

export type DropdownMenuContentProps = ComponentProps<typeof DropdownMenuPrimitive.Content>;

export const DropdownMenuContent = (props: DropdownMenuContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.Content
      class={cn(
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuArrowProps = ComponentProps<typeof DropdownMenuPrimitive.Arrow>;

export const DropdownMenuArrow = (props: DropdownMenuArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />
  );
};

export type DropdownMenuGroupProps = ComponentProps<typeof DropdownMenuPrimitive.Group>;

export const DropdownMenuGroup = (props: DropdownMenuGroupProps) => (
  <DropdownMenuPrimitive.Group {...props} />
);

export type DropdownMenuGroupLabelProps = ComponentProps<typeof DropdownMenuPrimitive.GroupLabel>;

export const DropdownMenuGroupLabel = (props: DropdownMenuGroupLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.GroupLabel
      class={cn(
        "px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuItemProps = ComponentProps<typeof DropdownMenuPrimitive.Item>;

export const DropdownMenuItem = (props: DropdownMenuItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.Item
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuItemLabelProps = ComponentProps<typeof DropdownMenuPrimitive.ItemLabel>;

export const DropdownMenuItemLabel = (props: DropdownMenuItemLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <DropdownMenuPrimitive.ItemLabel class={cn("text-sm", local.class)} {...others} />;
};

export type DropdownMenuItemDescriptionProps = ComponentProps<
  typeof DropdownMenuPrimitive.ItemDescription
>;

export const DropdownMenuItemDescription = (props: DropdownMenuItemDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.ItemDescription
      class={cn("text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type DropdownMenuItemIndicatorProps = ComponentProps<
  typeof DropdownMenuPrimitive.ItemIndicator
>;

export const DropdownMenuItemIndicator = (props: DropdownMenuItemIndicatorProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <DropdownMenuPrimitive.ItemIndicator
      class={cn("absolute left-2 inline-flex size-3.5 items-center justify-center", local.class)}
      {...others}
    >
      {local.children ?? (
        <span class="-mt-px block h-2 w-1.5 rotate-45 border-r-2 border-b-2 border-current" />
      )}
    </DropdownMenuPrimitive.ItemIndicator>
  );
};

export type DropdownMenuCheckboxItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

export const DropdownMenuCheckboxItem = (props: DropdownMenuCheckboxItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.CheckboxItem
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuRadioGroupProps = ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>;

export const DropdownMenuRadioGroup = (props: DropdownMenuRadioGroupProps) => (
  <DropdownMenuPrimitive.RadioGroup {...props} />
);

export type DropdownMenuRadioItemProps = ComponentProps<typeof DropdownMenuPrimitive.RadioItem>;

export const DropdownMenuRadioItem = (props: DropdownMenuRadioItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.RadioItem
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        "pl-8",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuSeparatorProps = ComponentProps<typeof DropdownMenuPrimitive.Separator>;

export const DropdownMenuSeparator = (props: DropdownMenuSeparatorProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <DropdownMenuPrimitive.Separator class={cn("my-1 bg-border", local.class)} {...others} />;
};

export type DropdownMenuSubProps = ComponentProps<typeof DropdownMenuPrimitive.Sub>;

export const DropdownMenuSub = (props: DropdownMenuSubProps) => (
  <DropdownMenuPrimitive.Sub {...props} />
);

export type DropdownMenuSubTriggerProps = ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>;

export const DropdownMenuSubTrigger = (props: DropdownMenuSubTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.SubTrigger
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuSubContentProps = ComponentProps<typeof DropdownMenuPrimitive.SubContent>;

export const DropdownMenuSubContent = (props: DropdownMenuSubContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.SubContent
      class={cn(
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 min-w-52 border border-border bg-popover p-1 text-sm text-popover-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

export type DropdownMenuIconProps = ComponentProps<typeof DropdownMenuPrimitive.Icon>;

export const DropdownMenuIcon = (props: DropdownMenuIconProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DropdownMenuPrimitive.Icon
      class={cn("ml-auto text-muted-foreground", local.class)}
      {...others}
    />
  );
};
