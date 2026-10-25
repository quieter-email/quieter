"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { domMax, LazyMotion } from "motion/react";
import { createContext, use, useId } from "react";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";
import { SelectionIndicator } from "./selection-indicator";

const ToggleSelectionContext = createContext<string | null>(null);

const toggleGroupVariants = cva(
  "inline-flex items-center gap-1 rounded-lg border border-border bg-bg shadow-sm squircle",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: { compact: "p-0.5", default: "p-1", flush: "p-0" },
      variant: {
        default: "",
        plain: "border-0 bg-transparent shadow-none",
        subtle: "border-0 bg-muted/40 shadow-none",
      },
    },
  }
);

const toggleVariants = cva(
  "relative isolate inline-flex shrink-0 items-center justify-center gap-2 bg-transparent font-medium whitespace-nowrap select-none squircle focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        compact: "h-6 px-2.5 text-caption",
        default: "h-8 px-3.5 text-body-sm",
        sm: "h-7 px-2.5 text-body-sm",
      },
      variant: {
        default:
          "rounded-md text-muted-fg hover:text-fg active:text-fg data-pressed:text-fg",
        pill: "rounded-full border border-border px-3 text-caption text-muted-fg hover:text-fg data-pressed:border-primary data-pressed:text-primary-fg data-pressed:hover:text-primary-fg",
        secondary:
          "rounded-md text-muted-fg hover:text-fg active:text-fg data-pressed:text-secondary-fg",
      },
    },
  }
);

export const ToggleGroup = ({
  className,
  multiple = false,
  size = "default",
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive> &
  VariantProps<typeof toggleGroupVariants>) => {
  const id = useId();
  return (
    <ToggleSelectionContext value={multiple ? null : id}>
      <ToggleGroupPrimitive
        className={cn(toggleGroupVariants({ size, variant }), className)}
        {...props}
        multiple={multiple}
      />
    </ToggleSelectionContext>
  );
};

export const Toggle = ({
  className,
  size = "default",
  variant = "default",
  ...props
}: ComponentPropsWithoutRef<typeof TogglePrimitive> &
  VariantProps<typeof toggleVariants>) => {
  const id = useId();
  const selectionId = use(ToggleSelectionContext) ?? id;
  return (
    <LazyMotion features={domMax}>
      <TogglePrimitive
        className={cn(toggleVariants({ size, variant }), className)}
        {...props}
        render={(toggleProps, state) => (
          <button {...toggleProps} type="button">
            {state.pressed && (
              <SelectionIndicator
                layoutId={selectionId}
                variant={
                  variant === "pill" ? "primary" : (variant ?? "default")
                }
              />
            )}
            {toggleProps.children}
          </button>
        )}
      />
    </LazyMotion>
  );
};
