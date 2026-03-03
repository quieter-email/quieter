import type { ComponentProps } from "solid-js";
import * as TooltipPrimitive from "@kobalte/core/tooltip";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type TooltipProps = ComponentProps<typeof TooltipPrimitive.Root>;

export const Tooltip = (props: TooltipProps) => <TooltipPrimitive.Root {...props} />;

export type TooltipTriggerProps = ComponentProps<typeof TooltipPrimitive.Trigger>;

export const TooltipTrigger = (props: TooltipTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TooltipPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type TooltipPortalProps = ComponentProps<typeof TooltipPrimitive.Portal>;

export const TooltipPortal = (props: TooltipPortalProps) => <TooltipPrimitive.Portal {...props} />;

export type TooltipContentProps = ComponentProps<typeof TooltipPrimitive.Content>;

export const TooltipContent = (props: TooltipContentProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <TooltipPrimitive.Content
      class={cn(
        "border border-border bg-popover text-popover-foreground",
        "data-[expanded]:animate-in data-[closed]:animate-out data-[expanded]:fade-in-0 data-[closed]:fade-out-0 z-50 max-w-64 px-2.5 py-1.5 text-xs",
        local.class,
      )}
      {...others}
    />
  );
};

export type TooltipArrowProps = ComponentProps<typeof TooltipPrimitive.Arrow>;

export const TooltipArrow = (props: TooltipArrowProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return <TooltipPrimitive.Arrow class={cn("[&>path]:fill-popover", local.class)} {...others} />;
};
