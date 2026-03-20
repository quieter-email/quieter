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
          actionButton:
            "inline-flex h-8 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3.5 text-[13px] font-medium leading-none text-foreground shadow-sm outline-none transition-colors duration-150 ease-out hover:bg-muted/60 active:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
          cancelButton:
            "inline-flex h-8 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-md bg-transparent px-3.5 text-[13px] font-medium leading-none text-foreground-light outline-none transition-colors duration-150 ease-out hover:bg-muted/60 hover:text-foreground active:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0 disabled:pointer-events-none disabled:opacity-50",
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
