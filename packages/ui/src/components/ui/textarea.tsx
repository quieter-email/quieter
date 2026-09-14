"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn";

const textareaVariants = cva(
  "min-h-20 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-body text-fg shadow-none transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        // Auto-growing composer field, e.g. the chat input.
        composer:
          "[field-sizing:content] max-h-40 min-h-[42px] resize-none rounded-[9px] border-border/70 bg-bg/45 px-3 py-2.5 text-body-sm leading-5 shadow-none placeholder:text-muted-fg focus-visible:ring-1",
        default: "",
      },
    },
  }
);

export const Textarea = ({
  className,
  variant,
  ...props
}: ComponentPropsWithoutRef<"textarea"> &
  VariantProps<typeof textareaVariants>) => (
  <textarea
    className={cn(textareaVariants({ variant }), className)}
    {...props}
  />
);
