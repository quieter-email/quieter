"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Drawer as DrawerPrimitive } from "vaul";

import { cn } from "../../lib/cn";
import { ActionFooter } from "./action-footer";
import { buttonFooterClassName, buttonVariants } from "./button";
import type { ButtonProps } from "./button";
import {
  overlayDescriptionClassName,
  overlayTitleClassName,
  overlayTriggerClassName,
} from "./overlay-chrome";

export const Drawer = DrawerPrimitive.Root;
export const DrawerPortal = DrawerPrimitive.Portal;

export const DrawerTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Trigger>) => (
  <DrawerPrimitive.Trigger
    className={cn("squircle", className, overlayTriggerClassName)}
    {...props}
  />
);

export const DrawerOverlay = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>) => (
  <DrawerPrimitive.Overlay
    className={cn("fixed inset-0 z-50 bg-black/50 backdrop-blur-sm", className)}
    {...props}
  />
);

export const DrawerHandle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Handle>) => (
  <DrawerPrimitive.Handle
    className={cn("mx-auto my-2 h-1.5 w-12 rounded-full bg-border", className)}
    {...props}
  />
);

export const DrawerContent = ({
  children,
  className,
  showHandle = false,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
  showHandle?: boolean;
}) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-bg-surface text-popover-fg shadow-lg",
        "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:max-h-[96vh] data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t",
        "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:max-h-[96vh] data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b",
        "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:h-full data-[vaul-drawer-direction=left]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=left]:rounded-r-xl data-[vaul-drawer-direction=left]:border-r",
        "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=right]:rounded-l-xl data-[vaul-drawer-direction=right]:border-l",
        className
      )}
      {...props}
    >
      {showHandle && <DrawerHandle />}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
);

export const DrawerHeader = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("border-b px-5 py-4", className)} {...props} />
);

export const DrawerBody = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("flex-1 px-5 py-4", className)} {...props} />
);

export const DrawerFooter = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) => (
  <ActionFooter className={cn("border-t px-5 py-4", className)} {...props} />
);

export const DrawerTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>) => (
  <DrawerPrimitive.Title
    className={cn(overlayTitleClassName, className)}
    {...props}
  />
);

export const DrawerDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>) => (
  <DrawerPrimitive.Description
    className={cn(overlayDescriptionClassName, className)}
    {...props}
  />
);

export const DrawerCloseButton = ({
  className,
  variant = "secondary",
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Close> & {
  // Close buttons support the core button looks; card, chip, and the other
  // special-purpose treatments do not belong in dialog footers.
  variant?: Exclude<
    ButtonProps["variant"],
    "card" | "chip" | "option" | "overlay" | "result"
  >;
}) => (
  <DrawerPrimitive.Close
    className={cn(
      buttonVariants({ variant }),
      buttonFooterClassName,
      className
    )}
    {...props}
  />
);
