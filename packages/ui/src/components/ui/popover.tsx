import type { ComponentProps } from "solid-js";
import * as PopoverPrimitive from "@kobalte/core/popover";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type PopoverProps = ComponentProps<typeof PopoverPrimitive.Root>;

export const Popover = (props: PopoverProps) => <PopoverPrimitive.Root {...props} />;

export type PopoverAnchorProps = ComponentProps<typeof PopoverPrimitive.Anchor>;

export const PopoverAnchor = (props: PopoverAnchorProps) => <PopoverPrimitive.Anchor {...props} />;

export type PopoverTriggerProps = ComponentProps<typeof PopoverPrimitive.Trigger>;

export const PopoverTrigger = (props: PopoverTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <PopoverPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type PopoverPortalProps = ComponentProps<typeof PopoverPrimitive.Portal>;

export const PopoverPortal = (props: PopoverPortalProps) => <PopoverPrimitive.Portal {...props} />;

export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>;

export const PopoverContent = (props: PopoverContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <PopoverPrimitive.Content
      class={cn(
        "border border-border bg-popover text-popover-foreground",
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 w-[min(92vw,22rem)] p-4",
        local.class,
      )}
      {...others}
    />
  );
};

export type PopoverArrowProps = ComponentProps<typeof PopoverPrimitive.Arrow>;

export const PopoverArrow = (props: PopoverArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <PopoverPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />;
};

export type PopoverTitleProps = ComponentProps<typeof PopoverPrimitive.Title>;

export const PopoverTitle = (props: PopoverTitleProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <PopoverPrimitive.Title
      class={cn("text-base font-semibold tracking-tight", local.class)}
      {...others}
    />
  );
};

export type PopoverDescriptionProps = ComponentProps<typeof PopoverPrimitive.Description>;

export const PopoverDescription = (props: PopoverDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <PopoverPrimitive.Description
      class={cn("mt-1 text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type PopoverCloseButtonProps = ComponentProps<typeof PopoverPrimitive.CloseButton>;

export const PopoverCloseButton = (props: PopoverCloseButtonProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <PopoverPrimitive.CloseButton
      class={cn(
        "inline-flex h-8 min-w-8 items-center justify-center border border-input bg-background px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/60",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    >
      {local.children ?? "Close"}
    </PopoverPrimitive.CloseButton>
  );
};
