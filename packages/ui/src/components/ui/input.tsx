"use client";

import type { ComponentPropsWithoutRef, ComponentRef, Ref } from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const inputVariants = cva(
  "w-full text-foreground transition-colors duration-150 ease-out outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive/20",
  {
    variants: {
      chrome: {
        default:
          "squircle rounded-md border border-input bg-background shadow-sm read-only:cursor-default read-only:bg-muted/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20",
        ghost:
          "border-0 bg-transparent shadow-none read-only:bg-transparent focus-visible:border-transparent focus-visible:ring-0",
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

type InputProps = Omit<ComponentPropsWithoutRef<typeof InputPrimitive>, "size"> &
  VariantProps<typeof inputVariants> & {
    ref?: Ref<ComponentRef<typeof InputPrimitive>>;
  };

export const Input = ({
  chrome = "default",
  className,
  ref,
  size = "default",
  ...props
}: InputProps) => (
  <InputPrimitive ref={ref} className={cn(inputVariants({ chrome, size }), className)} {...props} />
);
