"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cva } from "class-variance-authority";
import type { ButtonProps } from "./button";
import { cn } from "../../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger
    className={cn(
      "squircle",
      className,
      "transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
    )}
    {...props}
  />
);

export const DialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>) => (
  <DialogPortal>
    <DialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0",
      )}
    />
    <DialogPrimitive.Popup
      className={cn(
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-1/2 overflow-hidden rounded-xl border bg-background-light text-foreground shadow-lg transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
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

const dialogCloseButtonVariants = cva(
  "squircle inline-flex min-w-20 shrink-0 items-center justify-center gap-2 rounded-md px-3.5 text-[13px] font-medium whitespace-nowrap transition-transform duration-100 ease-out outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "h-8 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/85",
        outline:
          "h-8 border border-input bg-background-light text-foreground shadow-sm hover:bg-muted/60 active:bg-muted/80",
        ghost:
          "h-8 bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted/80 active:text-foreground",
        destructive:
          "h-8 bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  },
);

export const DialogCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Close> & {
  variant?: ButtonProps["variant"];
}) => (
  <DialogPrimitive.Close
    className={cn(dialogCloseButtonVariants({ variant }), className)}
    {...props}
  />
);
