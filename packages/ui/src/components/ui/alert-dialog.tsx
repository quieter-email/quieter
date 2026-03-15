"use client";

import type { ComponentPropsWithoutRef } from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { overlayBackdropClassName, overlayPanelClassName } from "./shared";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Popup>) => (
  <AlertDialogPortal>
    <AlertDialogPrimitive.Backdrop className={overlayBackdropClassName} />
    <AlertDialogPrimitive.Popup
      className={cn(
        overlayPanelClassName,
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-x-1/2 -translate-y-1/2 overflow-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Popup>
  </AlertDialogPortal>
);

export const AlertDialogHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const AlertDialogBody = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const AlertDialogFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("flex items-center justify-end gap-2 px-5 py-4", className)} {...props} />
);

export const AlertDialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    className={cn("text-base font-semibold tracking-tight text-foreground", className)}
    {...props}
  />
);

export const AlertDialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    className={cn("mt-2 text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const AlertDialogCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Close> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
}) => (
  <AlertDialogPrimitive.Close
    className={cn(buttonVariants({ size: "sm", variant }), "min-w-20", className)}
    {...props}
  />
);
