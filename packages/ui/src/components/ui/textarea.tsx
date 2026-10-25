"use client";

import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "../../lib/cn";

const composerStyles =
  "[field-sizing:content] max-h-40 min-h-10 resize-none rounded-sm border-border/70 bg-bg/45 px-3 py-2.5 text-body-sm leading-5 shadow-none placeholder:text-muted-fg focus-visible:ring-2";

const textareaVariants = cva(
  "min-h-20 w-full resize-y rounded-md border border-border bg-input px-3 py-2 text-body text-fg shadow-none transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      autoSize: {
        true: "[field-sizing:content] max-h-96 min-h-40 resize-none overflow-y-auto",
      },
      variant: {
        // Auto-growing composer field, e.g. the chat input.
        composer: composerStyles,
        "composer-action": `${composerStyles} pr-12`,
        default: "",
        prompt:
          "[field-sizing:content] max-h-40 min-h-16 resize-none rounded-none border-0 bg-transparent px-1 py-2 text-body-sm leading-5 focus-visible:ring-0",
      },
    },
  }
);

export const Textarea = ({
  autoSize,
  className,
  variant,
  ...props
}: ComponentPropsWithRef<"textarea"> &
  VariantProps<typeof textareaVariants>) => (
  <textarea
    className={cn(textareaVariants({ autoSize, variant }), className)}
    {...props}
  />
);
