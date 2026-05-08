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
