import type { ComponentProps } from "solid-js";
import * as DialogPrimitive from "@kobalte/core/dialog";
import { splitProps } from "solid-js";
import { cn } from "../../lib/cn";

export type DialogProps = ComponentProps<typeof DialogPrimitive.Root>;

export const Dialog = (props: DialogProps) => <DialogPrimitive.Root {...props} />;

export type DialogTriggerProps = ComponentProps<typeof DialogPrimitive.Trigger>;

export const DialogTrigger = (props: DialogTriggerProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogPrimitive.Trigger
      class={cn(
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export type DialogPortalProps = ComponentProps<typeof DialogPrimitive.Portal>;

export const DialogPortal = (props: DialogPortalProps) => <DialogPrimitive.Portal {...props} />;

export type DialogOverlayProps = ComponentProps<typeof DialogPrimitive.Overlay>;

export const DialogOverlay = (props: DialogOverlayProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogPrimitive.Overlay
      class={cn("fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px]", local.class)}
      {...others}
    />
  );
};

export type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content>;

export const DialogContent = (props: DialogContentProps) => {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        class={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 border-2 border-border bg-background text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          local.class,
        )}
        {...others}
      >
        {local.children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

export type DialogTitleProps = ComponentProps<typeof DialogPrimitive.Title>;

export const DialogTitle = (props: DialogTitleProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogPrimitive.Title
      class={cn("text-base font-semibold tracking-tight", local.class)}
      {...others}
    />
  );
};

export type DialogDescriptionProps = ComponentProps<typeof DialogPrimitive.Description>;

export const DialogDescription = (props: DialogDescriptionProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogPrimitive.Description
      class={cn("mt-2 text-sm text-muted-foreground", local.class)}
      {...others}
    />
  );
};

export type DialogCloseButtonProps = ComponentProps<typeof DialogPrimitive.CloseButton>;

export const DialogCloseButton = (props: DialogCloseButtonProps) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <DialogPrimitive.CloseButton
      class={cn(
        "inline-flex h-9 min-w-20 items-center justify-center border border-border bg-background px-3 text-sm font-medium text-foreground",
        "transition-all hover:-translate-y-px hover:bg-muted",
        "active:translate-y-0",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        local.class,
      )}
      {...others}
    />
  );
};

export const DialogHeader = (props: ComponentProps<"div">) => {
  const [local, others] = splitProps(props, ["class"]);

  return <div class={cn("border-b border-border px-5 py-4", local.class)} {...others} />;
};

export const DialogBody = (props: ComponentProps<"div">) => {
  const [local, others] = splitProps(props, ["class"]);

  return <div class={cn("px-5 py-4", local.class)} {...others} />;
};

export const DialogFooter = (props: ComponentProps<"div">) => {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      class={cn(
        "flex items-center justify-end gap-2 border-t border-border px-5 py-4",
        local.class,
      )}
      {...others}
    />
  );
};
