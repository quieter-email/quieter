"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { overlayBackdropClassName, overlayPanelClassName } from "./shared";

export const Drawer = DrawerPrimitive.Root;
export const DrawerTrigger = DrawerPrimitive.Trigger;
export const DrawerPortal = DrawerPrimitive.Portal;

export const DrawerOverlay = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>) => (
  <DrawerPrimitive.Overlay className={cn(overlayBackdropClassName, className)} {...props} />
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
        overlayPanelClassName,
        "fixed z-50 flex flex-col overflow-hidden bg-background-light",
        "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:max-h-[96vh] data-[vaul-drawer-direction=bottom]:rounded-t-[10px] data-[vaul-drawer-direction=bottom]:border-t",
        "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:max-h-[96vh] data-[vaul-drawer-direction=top]:rounded-b-[10px] data-[vaul-drawer-direction=top]:border-b",
        "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:h-full data-[vaul-drawer-direction=left]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=left]:rounded-r-2xl data-[vaul-drawer-direction=left]:border-r",
        "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=right]:rounded-l-2xl data-[vaul-drawer-direction=right]:border-l",
        className,
      )}
      {...props}
    >
      {showHandle ? <DrawerHandle /> : null}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
);

export const DrawerHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("border-b border-border px-5 py-4", className)} {...props} />
);

export const DrawerBody = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("flex-1 px-5 py-4", className)} {...props} />
);

export const DrawerFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn(
      "flex items-center justify-end gap-2 border-t border-border px-5 py-4",
      className,
    )}
    {...props}
  />
);

export const DrawerTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>) => (
  <DrawerPrimitive.Title
    className={cn("text-base font-semibold tracking-tight", className)}
    {...props}
  />
);

export const DrawerDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>) => (
  <DrawerPrimitive.Description
    className={cn("mt-2 text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const DrawerCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Close> & {
  variant?: "default" | "outline" | "ghost" | "destructive";
}) => (
  <DrawerPrimitive.Close
    className={cn(buttonVariants({ size: "sm", variant }), "min-w-20", className)}
    {...props}
  />
);
