"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type { ComponentPropsWithoutRef, ComponentRef, Ref } from "react";

import { cn } from "../../lib/cn";
import {
  ghostInputClassName,
  inputControlClassName,
  inputControlSizeVariants,
} from "./input-chrome";

export const inputVariants = cva(inputControlClassName, {
  compoundVariants: [
    {
      chrome: "ghost",
      className: "px-2.5",
    },
    {
      chrome: "inline",
      className: "h-5 min-w-0 p-0 text-body",
    },
  ],
  defaultVariants: {
    chrome: "default",
    size: "default",
  },
  variants: {
    chrome: {
      attached:
        "border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
      default:
        "squircle rounded-md border border-border bg-input shadow-none read-only:cursor-default read-only:bg-input",
      ghost: ghostInputClassName,
      inline:
        "rounded-none border-0 bg-transparent shadow-none read-only:bg-transparent",
    },
    size: inputControlSizeVariants,
  },
});

type InputProps = Omit<
  ComponentPropsWithoutRef<typeof InputPrimitive>,
  "size"
> &
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
  <InputPrimitive
    ref={ref}
    className={cn(
      inputVariants({ chrome, size }),
      {
        "h-full min-w-0 flex-1 pr-1": chrome === "attached",
      },
      className
    )}
    {...props}
  />
);
