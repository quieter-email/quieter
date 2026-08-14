"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { cva } from "class-variance-authority";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import type { ButtonProps } from "./button";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Trigger>) => (
  <AlertDialogPrimitive.Trigger
    className={cn(
      "squircle",
      className,
      "transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100"
    )}
    {...props}
  />
);

export const AlertDialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Popup>) => (
  <AlertDialogPortal>
    <AlertDialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0"
      )}
    />
    <AlertDialogPrimitive.Popup
      className={cn(
        "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-1/2 overflow-hidden rounded-xl border bg-popover text-popover-fg shadow-lg transition-[opacity,transform] duration-150 ease-out will-change-[opacity,transform] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
        className
      )}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Popup>
  </AlertDialogPortal>
);

export const AlertDialogHeader = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const AlertDialogBody = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

export const AlertDialogFooter = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn("flex items-center justify-end gap-2 px-5 py-4", className)}
    {...props}
  />
);

export const AlertDialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    className={cn("text-base font-semibold tracking-tight text-fg", className)}
    {...props}
  />
);

export const AlertDialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    className={cn("mt-2 text-sm text-muted-fg", className)}
    {...props}
  />
);

const alertDialogCloseButtonVariants = cva(
  "squircle inline-flex min-w-20 shrink-0 items-center justify-center gap-2 rounded-md px-3.5 text-[13px] font-medium whitespace-nowrap transition-transform duration-100 ease-out select-none focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    defaultVariants: {
      variant: "outline",
    },
    variants: {
      variant: {
        default:
          "h-8 bg-primary text-primary-fg shadow-sm hover:bg-primary/90 active:bg-primary/85",
        destructive:
          "h-8 bg-destructive text-destructive-fg shadow-sm hover:bg-destructive/90 active:bg-destructive/85",
        ghost:
          "h-8 bg-transparent text-muted-fg hover:bg-muted hover:text-fg active:bg-muted/80 active:text-fg",
        outline:
          "h-8 border border-border bg-bg-surface text-fg shadow-sm hover:bg-muted active:bg-muted/80",
      },
    },
  }
);

export const AlertDialogCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Close> & {
  variant?: ButtonProps["variant"];
}) => (
  <AlertDialogPrimitive.Close
    className={cn(alertDialogCloseButtonVariants({ variant }), className)}
    {...props}
  />
);
