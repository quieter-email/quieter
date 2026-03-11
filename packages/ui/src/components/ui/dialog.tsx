"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../../lib/cn";
import { Button, buttonVariants } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>) => (
  <DialogPortal>
    <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
    <DialogPrimitive.Popup
      className={cn(
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-background-light text-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Popup>
  </DialogPortal>
);

export const DialogHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const DialogBody = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("flex items-center justify-end gap-2 px-5 py-4", className)} {...props} />
);

export const DialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-base font-semibold tracking-tight", className)}
    {...props}
  />
);

export const DialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("mt-2 text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const DialogCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Close> & {
  variant?: ComponentPropsWithoutRef<typeof Button>["variant"];
}) => (
  <DialogPrimitive.Close
    className={cn(buttonVariants({ size: "sm", variant }), "min-w-20", className)}
    {...props}
  />
);
