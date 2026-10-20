"use client";

import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { buttonFooterClassName, buttonVariants } from "./button";
import type { ButtonProps } from "./button";
import {
  overlayBackdropClassName,
  overlayDescriptionClassName,
  overlayPopupClassName,
  overlayTitleClassName,
  overlayTriggerClassName,
} from "./overlay-chrome";

export {
  DialogBody as AlertDialogBody,
  DialogFooter as AlertDialogFooter,
  DialogHeader as AlertDialogHeader,
} from "./dialog";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export const AlertDialogTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Trigger>) => (
  <AlertDialogPrimitive.Trigger
    className={cn("squircle", className, overlayTriggerClassName)}
    {...props}
  />
);

export const AlertDialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Popup>) => (
  <AlertDialogPortal>
    <AlertDialogPrimitive.Backdrop className={overlayBackdropClassName} />
    <AlertDialogPrimitive.Popup
      className={cn(
        overlayPopupClassName,
        "bg-popover text-popover-fg",
        className
      )}
      {...props}
    >
      {children}
    </AlertDialogPrimitive.Popup>
  </AlertDialogPortal>
);

export const AlertDialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>) => (
  <AlertDialogPrimitive.Title
    className={cn(overlayTitleClassName, "text-fg", className)}
    {...props}
  />
);

export const AlertDialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>) => (
  <AlertDialogPrimitive.Description
    className={cn(overlayDescriptionClassName, className)}
    {...props}
  />
);

export const AlertDialogCloseButton = ({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Close> & {
  // Close buttons support the core button looks; card, chip, and the other
  // special-purpose treatments do not belong in dialog footers.
  variant?: Exclude<
    ButtonProps["variant"],
    "card" | "chip" | "option" | "overlay" | "result"
  >;
}) => (
  <AlertDialogPrimitive.Close
    className={cn(
      buttonVariants({ variant }),
      buttonFooterClassName,
      className
    )}
    {...props}
  />
);
