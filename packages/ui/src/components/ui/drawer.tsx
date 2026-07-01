"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cva } from "class-variance-authority";
import { Drawer as DrawerPrimitive } from "vaul";
import type { ButtonProps } from "./button";
import { cn } from "../../lib/cn";

export const Drawer = DrawerPrimitive.Root;
export const DrawerPortal = DrawerPrimitive.Portal;

export const DrawerTrigger = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Trigger>) => (
  <DrawerPrimitive.Trigger
    className={cn(
      "squircle",
      className,
      "transition-transform duration-100 ease-out active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100",
    )}
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
        "fixed z-50 flex flex-col overflow-hidden rounded-xl border bg-background-light text-popover-foreground shadow-lg outline-none",
        "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:max-h-[96vh] data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t",
        "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:max-h-[96vh] data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b",
        "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:h-full data-[vaul-drawer-direction=left]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=left]:rounded-r-2xl data-[vaul-drawer-direction=left]:border-r",
        "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-[min(92vw,32rem)] data-[vaul-drawer-direction=right]:rounded-l-2xl data-[vaul-drawer-direction=right]:border-l",
        className,
      )}
      {...props}
    >
      {showHandle && <DrawerHandle />}
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
);

export const DrawerHeader = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("border-b px-5 py-4", className)} {...props} />
);

export const DrawerBody = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("flex-1 px-5 py-4", className)} {...props} />
);

export const DrawerFooter = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div
    className={cn("flex items-center justify-end gap-2 border-t px-5 py-4", className)}
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

const drawerCloseButtonVariants = cva(
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

export const DrawerCloseButton = ({
  className,
  variant = "outline",
  ...props
}: ComponentPropsWithoutRef<typeof DrawerPrimitive.Close> & {
  variant?: ButtonProps["variant"];
}) => (
  <DrawerPrimitive.Close
    className={cn(drawerCloseButtonVariants({ variant }), className)}
    {...props}
  />
);
