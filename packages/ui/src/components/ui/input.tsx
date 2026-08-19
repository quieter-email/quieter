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

const inputVariants = cva(
  "w-full text-fg transition-colors duration-150 ease-out placeholder:text-muted-fg focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/45 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive aria-invalid:focus-visible:ring-destructive/45",
  {
    defaultVariants: {
      chrome: "default",
      size: "default",
    },
    variants: {
      chrome: {
        default:
          "squircle rounded-md border border-border bg-input shadow-sm read-only:cursor-default read-only:bg-input",
        ghost: "border-0 bg-transparent shadow-none read-only:bg-transparent",
      },
      size: {
        default: "h-9 px-3 text-body",
        lg: "h-10 px-4 text-body-lg",
        sm: "h-8 px-3 text-body-sm",
      },
    },
  }
);

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
        chrome === "ghost" && "min-w-0 flex-1",
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
