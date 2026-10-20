"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import type {
  ComponentPropsWithoutRef,
  ComponentRef,
  ReactNode,
  Ref,
} from "react";

import { cn } from "../../lib/cn";
import {
  inputControlClassName,
  inputControlSizeVariants,
} from "./input-chrome";

export const inputVariants = cva(inputControlClassName, {
  defaultVariants: {
    chrome: "default",
    size: "default",
  },
  variants: {
    chrome: {
      attached: "border-0 bg-transparent shadow-none focus-visible:ring-0",
      default:
        "squircle rounded-md border border-border bg-input shadow-none read-only:cursor-default read-only:bg-input",
      ghost: "border-0 bg-transparent shadow-none read-only:bg-transparent",
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

export const GhostFieldShell = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full min-w-0 flex-1 items-stretch gap-2 has-focus-visible:**:data-[slot=ghost-focus]:bg-fg/50">
    <span
      aria-hidden
      className="w-0.5 shrink-0 self-stretch rounded-md bg-transparent transition-colors"
      data-slot="ghost-focus"
    />
    {children}
  </div>
);

export const Input = ({
  chrome = "default",
  className,
  ref,
  size = "default",
  ...props
}: InputProps) => {
  const input = (
    <InputPrimitive
      ref={ref}
      className={cn(
        inputVariants({ chrome, size }),
        {
          "h-full min-w-0 flex-1 pr-1": chrome === "attached",
          "min-w-0 flex-1": chrome === "ghost",
        },
        className
      )}
      {...props}
    />
  );

  if (chrome !== "ghost") {
    return input;
  }

  return <GhostFieldShell>{input}</GhostFieldShell>;
};
