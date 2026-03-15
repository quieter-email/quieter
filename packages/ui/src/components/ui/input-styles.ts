"use client";

import { cva } from "class-variance-authority";

export const inputVariants = cva(
  "w-full text-foreground outline-none transition-colors duration-150 ease-out placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20",
  {
    variants: {
      chrome: {
        default:
          "rounded-md border border-input bg-background shadow-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 read-only:cursor-default read-only:bg-muted/30",
        ghost: "border-0 bg-transparent shadow-none focus-visible:ring-0 read-only:bg-transparent",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        default: "h-9 px-3 text-sm",
        lg: "h-10 px-4 text-base",
      },
    },
    defaultVariants: {
      chrome: "default",
      size: "default",
    },
  },
);
