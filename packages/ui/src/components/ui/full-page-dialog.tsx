"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "../../lib/cn";

export const FullPageDialog = DialogPrimitive.Root;
export const FullPageDialogTrigger = DialogPrimitive.Trigger;

export const FullPageDialogContent = ({
  children,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Popup>) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm transition-opacity duration-200 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
    <DialogPrimitive.Popup
      className={cn(
        "fixed inset-2 z-50 flex flex-col overflow-hidden rounded-xl border bg-background-light text-foreground shadow-2xl transition-[opacity,transform] duration-200 ease-out will-change-[opacity,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-ending-style:scale-[0.99] data-ending-style:opacity-0 data-starting-style:scale-[0.99] data-starting-style:opacity-0 sm:inset-4 lg:inset-6",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal>
);

export const FullPageDialogHeader = ({
  className,
  ...props
}: ComponentPropsWithoutRef<"header">) => (
  <header
    className={cn("flex h-12 shrink-0 items-center gap-3 border-b px-3 sm:h-14 sm:px-4", className)}
    {...props}
  />
);

export const FullPageDialogBody = ({ className, ...props }: ComponentPropsWithoutRef<"div">) => (
  <div className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...props} />
);

export const FullPageDialogTitle = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) => (
  <DialogPrimitive.Title
    className={cn("text-sm font-semibold tracking-tight", className)}
    {...props}
  />
);

export const FullPageDialogDescription = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const FullPageDialogClose = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Close>) => (
  <DialogPrimitive.Close
    className={cn(
      "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none squircle hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 active:scale-[0.97] [&_svg]:size-4",
      className,
    )}
    {...props}
  />
);
