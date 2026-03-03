import type { ComponentProps } from "solid-js";
import * as NavigationMenuPrimitive from "@kobalte/core/navigation-menu";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type NavigationMenuProps = ComponentProps<typeof NavigationMenuPrimitive.Root>;

export const NavigationMenu = (props: NavigationMenuProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Root
      class={cn("relative flex items-center gap-1", local.class)}
      {...others}
    />
  );
};

export type NavigationMenuMenuProps = ComponentProps<typeof NavigationMenuPrimitive.Menu>;

export const NavigationMenuMenu = (props: NavigationMenuMenuProps) => (
  <NavigationMenuPrimitive.Menu {...props} />
);

export type NavigationMenuTriggerProps = ComponentProps<typeof NavigationMenuPrimitive.Trigger>;

export const NavigationMenuTrigger = (props: NavigationMenuTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Trigger
      class={cn(
        "inline-flex h-10 items-center justify-center border border-transparent px-3 text-sm font-medium text-foreground transition-colors hover:border-border hover:bg-muted/60",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type NavigationMenuPortalProps = ComponentProps<typeof NavigationMenuPrimitive.Portal>;

export const NavigationMenuPortal = (props: NavigationMenuPortalProps) => (
  <NavigationMenuPrimitive.Portal {...props} />
);

export type NavigationMenuContentProps = ComponentProps<typeof NavigationMenuPrimitive.Content>;

export const NavigationMenuContent = (props: NavigationMenuContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Content
      class={cn(
        "data-[motion=from-start]:animate-in data-[motion=from-end]:animate-in data-[motion=to-start]:animate-out data-[motion=to-end]:animate-out w-[min(90vw,24rem)] p-4",
        "border border-border bg-popover text-popover-foreground",
        local.class,
      )}
      {...others}
    />
  );
};

export type NavigationMenuItemProps = ComponentProps<typeof NavigationMenuPrimitive.Item>;

export const NavigationMenuItem = (props: NavigationMenuItemProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Item
      class={cn(
        "relative flex min-h-9 cursor-default items-center gap-2 border border-transparent px-2.5 text-sm text-foreground transition-colors outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:border-border data-[highlighted]:bg-muted/60",
        "h-auto min-h-0 justify-start px-3 py-2",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type NavigationMenuViewportProps = ComponentProps<typeof NavigationMenuPrimitive.Viewport>;

export const NavigationMenuViewport = (props: NavigationMenuViewportProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Viewport
      class={cn(
        "border border-border bg-popover text-popover-foreground",
        "absolute top-full left-0 z-50 mt-2 w-[min(90vw,24rem)] overflow-hidden",
        local.class,
      )}
      {...others}
    />
  );
};

export type NavigationMenuArrowProps = ComponentProps<typeof NavigationMenuPrimitive.Arrow>;

export const NavigationMenuArrow = (props: NavigationMenuArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />
  );
};

export type NavigationMenuSeparatorProps = ComponentProps<typeof NavigationMenuPrimitive.Separator>;

export const NavigationMenuSeparator = (props: NavigationMenuSeparatorProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.Separator class={cn("my-1 bg-border", local.class)} {...others} />
  );
};

export type NavigationMenuGroupProps = ComponentProps<typeof NavigationMenuPrimitive.Group>;

export const NavigationMenuGroup = (props: NavigationMenuGroupProps) => (
  <NavigationMenuPrimitive.Group {...props} />
);

export type NavigationMenuGroupLabelProps = ComponentProps<
  typeof NavigationMenuPrimitive.GroupLabel
>;

export const NavigationMenuGroupLabel = (props: NavigationMenuGroupLabelProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <NavigationMenuPrimitive.GroupLabel
      class={cn(
        "px-2.5 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase",
        local.class,
      )}
      {...others}
    />
  );
};
