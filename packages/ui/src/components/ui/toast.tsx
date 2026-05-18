"use client";

import { Toaster as SonnerToaster, toast, type ExternalToast, type ToasterProps } from "sonner";
import { cn } from "../../lib/cn";
import { useColorMode } from "./color-mode";

export { toast };
export type { ExternalToast, ToasterProps };

export const Toaster = ({ className, toastOptions, ...props }: ToasterProps) => {
  const { colorMode } = useColorMode();

  return (
    <SonnerToaster
      className={cn("toaster group", className)}
      offset={16}
      position="bottom-right"
      richColors
      theme={colorMode}
      toastOptions={{
        ...toastOptions,
        duration: 4000,
        unstyled: true,
        classNames: {
          actionButton:
            "squircle inline-flex h-8 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3.5 text-[13px] font-medium text-foreground shadow-sm transition-transform duration-100 ease-out outline-none hover:bg-muted/60 active:scale-[0.97] active:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
          cancelButton:
            "squircle inline-flex h-8 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md bg-transparent px-3.5 text-[13px] font-medium text-foreground transition-transform duration-100 ease-out outline-none hover:bg-muted/60 hover:text-foreground active:scale-[0.97] active:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none motion-reduce:active:scale-100 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
          closeButton:
            "squircle absolute top-3 right-3 flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground transition-transform duration-100 ease-out active:scale-[0.97] hover:text-foreground motion-reduce:transition-none motion-reduce:active:scale-100",
          content: "grid gap-1.5 pr-8",
          default: "border-border/80 bg-popover text-popover-foreground",
          description: "text-sm text-current/75",
          error: "border-destructive bg-destructive text-destructive-foreground",
          icon: "relative flex size-4 shrink-0 items-center justify-center [&_svg]:size-5 [&_svg]:shrink-0",
          info: "border-primary/20",
          loading: "border-border/80 bg-popover text-popover-foreground",
          success: "border-success bg-success text-success-foreground",
          title: "text-sm font-semibold text-current",
          toast:
            "squircle group pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border p-4 shadow-lg",
          warning: "border-warning bg-warning text-warning-foreground",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
};
