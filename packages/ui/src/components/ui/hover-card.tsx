import type { ComponentProps } from "solid-js";
import * as HoverCardPrimitive from "@kobalte/core/hover-card";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type HoverCardProps = ComponentProps<typeof HoverCardPrimitive.Root>;

export const HoverCard = (props: HoverCardProps) => <HoverCardPrimitive.Root {...props} />;

export type HoverCardTriggerProps = ComponentProps<typeof HoverCardPrimitive.Trigger>;

export const HoverCardTrigger = (props: HoverCardTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <HoverCardPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type HoverCardPortalProps = ComponentProps<typeof HoverCardPrimitive.Portal>;

export const HoverCardPortal = (props: HoverCardPortalProps) => (
  <HoverCardPrimitive.Portal {...props} />
);

export type HoverCardContentProps = ComponentProps<typeof HoverCardPrimitive.Content>;

export const HoverCardContent = (props: HoverCardContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <HoverCardPrimitive.Content
      class={cn(
        "border border-border bg-popover text-popover-foreground",
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 w-72 p-4 text-sm",
        local.class,
      )}
      {...others}
    />
  );
};

export type HoverCardArrowProps = ComponentProps<typeof HoverCardPrimitive.Arrow>;

export const HoverCardArrow = (props: HoverCardArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <HoverCardPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />;
};
