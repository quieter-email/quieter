"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { ActionFooter } from "./action-footer";
import { buttonFooterClassName, buttonVariants } from "./button";
import type { ButtonProps } from "./button";
import {
  overlayBackdropClassName,
  overlayDescriptionClassName,
  overlayPopupClassName,
  overlayTitleClassName,
  overlayTriggerClassName,
} from "./overlay-chrome";

export const Dialog = DialogPrimitive.Root;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>) => (
  <DialogPrimitive.Trigger
    className={cn("squircle", className, overlayTriggerClassName)}
    {...props}
  />
);

export const DialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>) => (
  <DialogPortal>
    <DialogPrimitive.Backdrop className={overlayBackdropClassName} />
    <DialogPrimitive.Popup
      className={cn(overlayPopupClassName, "bg-bg-surface text-fg", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Popup>
  </DialogPortal>
);

export const DialogHeader = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("px-5 py-4", className)} {...props} />
);

const dialogBodySpacing = {
  "3": "space-y-3",
  "4": "space-y-4",
  "5": "space-y-5",
};

export const DialogBody = ({
  className,
  spacing,
  ...props
}: ComponentPropsWithoutRef<"div"> & {
  spacing?: "3" | "4" | "5";
}) => (
  <div
    className={cn(
      "px-5 py-4",
      spacing === undefined ? undefined : dialogBodySpacing[spacing],
      className
    )}
    {...props}
  />
);

export const DialogFooter = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <ActionFooter className={cn("px-5 py-4", className)} {...props} />
);

export const DialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn(overlayTitleClassName, className)}
    {...props}
  />
);

export const DialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn(overlayDescriptionClassName, className)}
    {...props}
  />
);

export const DialogCloseButton = ({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Close> & {
  // Close buttons support the core button looks; card, chip, and the other
  // special-purpose treatments do not belong in dialog footers.
  variant?: Exclude<
    ButtonProps["variant"],
    "card" | "chip" | "option" | "overlay" | "result"
  >;
}) => (
  <DialogPrimitive.Close
    className={cn(
      buttonVariants({ variant }),
      buttonFooterClassName,
      className
    )}
    {...props}
  />
);
