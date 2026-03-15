"use client";

import { Toaster as SonnerToaster, toast, type ExternalToast, type ToasterProps } from "sonner";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button";
import { useColorMode } from "./color-mode";

export { toast };
export type { ExternalToast, ToasterProps };

export const Toaster = ({ className, toastOptions, ...props }: ToasterProps) => {
  const { colorMode } = useColorMode();

  return (
    <SonnerToaster
      className={cn("toaster group", className)}
      closeButton
      expand
      offset={16}
      position="bottom-right"
      richColors={false}
      theme={colorMode}
      toastOptions={{
        ...toastOptions,
        duration: 4000,
        unstyled: true,
        classNames: {
          actionButton: buttonVariants({ size: "sm", variant: "outline" }),
          cancelButton: buttonVariants({ size: "sm", variant: "ghost" }),
          closeButton:
            "absolute top-3 right-3 flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground",
          content: "grid gap-1.5 pr-8",
          default: "border-border/80",
          description: "text-sm text-muted-foreground",
          error: "border-destructive/40",
          info: "border-primary/20",
          loading: "border-border/80",
          success: "border-success/30",
          title: "text-sm font-semibold text-foreground",
          toast:
            "group pointer-events-auto relative flex w-full items-start gap-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg",
          warning: "border-warning/40",
          ...toastOptions?.classNames,
        },
      }}
      {...props}
    />
  );
};
